/**
 * Database driver
 * @author ishafer
 */
require.paths.unshift("./node_modules");
require.paths.unshift("./public/js");
require.paths.unshift(".");

/*
Our DB options on cloudfoundry: Redis, MySQL, MongoDB
Why not Redis? Redis has slow middle-of-list lookup (O(n))
 and prioritizes insertion. We know the length of our lists
 a priori.
Why not MySQL? Our data is schemaless timeseries data.
*/

var m = require("mongodb"),
    log = require("log").getLogger(0),
    sys = require("sys");

//thanks https://github.com/gatesvp/cloudfoundry_node_mongodb/blob/master/app.js.2
if(process.env.VCAP_SERVICES){
  var env = JSON.parse(process.env.VCAP_SERVICES);
  exports.mongo = env["mongodb-1.8"][0]["credentials"];
}
else{
  exports.mongo = {"hostname":"localhost","port":27017,"username":"",
    "password":"","name":"","db":""};
}
var generate_mongo_url = function(obj){
  obj.hostname = (obj.hostname || "localhost");
  obj.port = (obj.port || 27017);
  obj.db = (obj.db || "test");

  if(obj.username && obj.password){
    return "mongodb://" + obj.username + ":" + obj.password + "@" + obj.hostname + ":" + obj.port + "/" + obj.db;
  }
  else{
    return "mongodb://" + obj.hostname + ":" + obj.port + "/" + obj.db;
  }
}
var mongourl = exports.mongourl = generate_mongo_url(exports.mongo);

var COLL_TS = "ts";
var COLL_FS = "fs.files";
/**
 * Connect to a collection
 * @param name collection name (see COLL_TS, COLL_FS)
 * @param next continuation(error, collection)
 */
exports.getcoll = function(name, next) {
    m.connect(mongourl, function(err, conn) {
        if (err) {
            next(err, null);
        } else {
            conn.collection(name, function(err, coll) {
                if (err) {
                    next(err, null);
                } else {
                    next(null, coll);    
                }
            });
        }
    });
};

/**
 * Unused; sample of how to connect and write to DB.
 */
exports.addts = function(key, data, next) {
    exports.getcoll(function(err, coll) {
        coll.insert({"key": key, "data": data}, {safe:true},
            function(err) {
                next();
            });
    });
}

/**
 * Get file info for the given query
 * @param selector a list of files to select (e.g. {"filename": name})
 */
exports.getFileInfo = function(selector, next) {
    exports.getcoll(COLL_FS, function(err, coll) {
        if (err) {
            log(1, "DB connection error:\n " + sys.inspect(err));
            next([]);
        } else {
            coll.find(selector, function(err, cursor) {
                var files = [];
                cursor.each(function(err, item) {
                    if (null == item) {
                        next(files);
                    } else {
                        files.push(item);
                    }
                });
            });
        }
    });
}

//gridfs source:
//https://github.com/christkv/node-mongodb-native/tree/master/lib/mongodb/gridfs

/**
 * Create a new timeseries store
 * @param fname the base filename
 * @param level the z zoom level (0 is raw data)
 * @param props file open properties.
 *   required: mode ("r"/"w")
 *   optional: metadata (metadata to write to file when first opened)
 * @param next continuation()
 */
exports.TStore = function(fname, level, props, next) {
    var self = this;
    
    self.minx = Infinity;
    self.maxx = -Infinity;
    
    self.fname = fname;
    self.level = level;
    //condition var for open status
    self.opened = false;
    //write queue
    self.writeq = [];
    self.writing = false;
    
    var mode = props.mode;
    var metadata = props.metadata;
    if (!metadata) {
        metadata = {};
    }
    
    self.fullname = fname + "." + level;
    log(0, "Created TStore " + fname + " level=" + level);
    m.connect(mongourl, function(err, conn) {
        if (err) {
            log(1, "DB connection error:\n " + sys.inspect(err));
        }
        self.gs = new m.GridStore(conn, self.fullname, mode,
            mode == "r" ? null : {
           "content_type": "binary/octet-stream",
           "metadata": metadata,
           "chunk_size": 1024*16
        });
        self.gs.open(function(err, gs) {
           log(0, "Opened gridstore " + self.fullname);
           self.gs = gs;
           self.opened = true;
           next();
        });
    });
}
/**
 * Flush this TStore and reopen with the given mode.
 * @param mode mode to reopen in
 * @param next callback that will receive the reopened TStore
 */
exports.TStore.prototype.reopen = function(mode, next) {
    var self = this;
    self.close(function() {
        var newts = new exports.TStore(self.fname, self.level, {mode: mode}, function() {
            next(newts);
        });
    });
}

exports.TStore.prototype.getLevel = function() {
    var self = this;
    return self.level;
}
exports.TStore.prototype.getName = function() {
    var self = this;
    return self.fname;
}
/**
 * Wait on a condition variable
 * @param v the condition variable fn to wait on
 * @param next continuation()
 */
exports.TStore.prototype.wait = function(v, next) {
    var self = this;
    
    if (v(self)) {
        next();
    } else {
        setTimeout(function() {
            self.wait(v, next);    
        }, 5);
    }
}
exports.TStore.prototype.wOpen = function(t) { return t.opened; }
exports.TStore.prototype.wBusy = function(t) { return t.writeq.length == 0; }
exports.TStore.prototype.wWriting = function(t) { return !t.writing; }

/**
 * Write the entire buffer buf into this TStore
 * @param buf the buffer to write
 * @param next continuation(err)
 */
exports.TStore.prototype.writeBuf = function(buf, next) {
    var self = this;
    self.writeq.push(buf);
    
    self.wait(self.wOpen, function() {
        //write lock appears to be necessary on newer versions of mongo connector
        self.wait(self.wWriting, function() {
            self.writing = true;
            
            if (self.closed) {
                log(1, "WARN: gridstore " + self.fname + " is closed");    
            }
            var bwrite = self.writeq.shift();
            
            //TODO: streaming bounds computation is not guaranteed to succeed
            // (chunk length could be small towards beginning or end of stream)
            if (bwrite.length >= 8) {
                if (self.gs.position % 8 == 0) {
                    log(0, "MIN pos satisfied");
                    self.minx = Math.min(self.minx, toints(bwrite, 0).x);
                }
                if ((self.gs.position + bwrite.length) % 8 == 0) {
                    log(0, "MAX pos satisfied");
                    var s = bwrite.length - 8;
                    self.maxx = Math.max(self.maxx,
                        (bwrite[s+0] | bwrite[s+1]<<8 | bwrite[s+2]<<16 | bwrite[s+3]<<24));
                }
            }
            log(0, "Writing buffer len=" + bwrite.length +
                " minx=" + self.minx + " maxx=" + self.maxx);
            self.gs.writeBuffer(bwrite, false, function() {
                self.writing = false;
                next();
            });
        });
    });
}
/**
 * Get all contents from the TStore as a string
 * @param next continuation(string)
 */
exports.TStore.prototype.readStr = function(next) {
    var self = this;
    self.wait(self.wBusy, function() {
        self.wait(self.wOpen, function() {
            self.gs.seek(0, function(n, gs2) {
                //readBuffer appears to be broken
                // (returns 0-length buffer).
                gs2.read(function(err, data) {
                    next(data);
                });            
            });
        });
    });
};
/**
 * Get all contents from the TStore as a buffer
 * @param next continuation(buffer)
 */
exports.TStore.prototype.readBuf = function(next) {
    var self = this;
    self.readStr(function(data) {
        next(new Buffer(data, encoding="binary")); 
    });
}

/**
 * Obtain the {x: timestamp, y: value} representation of point i
 * @param buf the buffer to query
 * @param i datapoint index
 */
var toints = function(buf, i) {
    return {
        x:(buf[i*8+0] | buf[i*8+1]<<8 | buf[i*8+2]<<16 | buf[i*8+3]<<24),
        y:(buf[i*8+4] | buf[i*8+5]<<8 | buf[i*8+6]<<16 | buf[i*8+7]<<24)
    };
}
/**
 * Write the 4-byte representation of val to buf at pos
 * @param x x (time) value to write
 * @param y y (value) value to write
 * @param buf the buffer to write into
 * @param pos the (point) position to start wrting at
 */
var writeval = function(x, y, buf, pos) {
    x = Math.floor(x); y = Math.floor(y);
    pos = pos*8;
    buf[pos+0] = x;
    buf[pos+1] = x >> 8;
    buf[pos+2] = x >> 16;
    buf[pos+3] = x >> 24;
    buf[pos+4] = y;
    buf[pos+5] = y >> 8;
    buf[pos+6] = y >> 16;
    buf[pos+7] = y >> 24;
}

/**
 * Log contents of buf between start and end
 * @param buf buffer to print
 * @param start (raw) index
 * @param end (raw) index, noninclusive
 */
var debugbuf = function(buf, start, end) {
    var tmpbuf = new Buffer(end-start);
    buf.copy(tmpbuf, 0, start, end);
    log(0, "buffer -> " + sys.inspect(tmpbuf));
}

/**
 * Get the length (in datapoints) of a buffer
 * @param buf the buffer to query
 */
var getlen = function(buf) {
    return Math.floor(buf.length / 8);
}

/**
 * Binary search. Return -(pos_to_insert) if value is not found.
 * @param buf buffer to search
 * @param val x (time) value to search for
 */
var binSearch = function(buf, val) {
    var lo = 0;
    var hi = getlen(buf)-1;
    var elt = 0;
    while (lo <= hi) {
        mid = Math.floor(lo/2 + hi/2);
        elt = toints(buf, mid).x;
        if (elt > val) {
            hi = mid - 1;
        } else if (elt < val) {
            lo = mid + 1;
        } else {
            return mid;
        }
    }
    
    return -mid;
}

exports.binSearch = binSearch;

exports.toArray = function(buf, lo, hi) {
    var res = [];
    for (var i = lo; i <= hi; ++i) {
        res.push(toints(buf, i));
    }
    return res;
}

/**
 * Aggregation functions
 * Must accept (buf, oldpts, newpts, newbuf)
 */
var aggregates = {
    //sample every other point
    "sample": function(buf, oldpts, newpts, newbuf) {
        for (i = 0; i < newbuf.length - 1; i += 8) {
            buf.copy(newbuf, i, i*2, i*2+8);
        }
        buf.copy(newbuf, (newpts-1)*8, (oldpts-1)*8);
        return newbuf;
    },
    //half-size averaged tiles (seadragon-style)
    "mean": function(buf, oldpts, newpts, newbuf) {
        var pt1 = null;
        var pt2 = null;
        for (var i = 0; i < newpts-1; ++i) {
            pt1 = toints(buf, i*2);
            pt2 = toints(buf, i*2+1);
            writeval(pt1.x/2+pt2.x/2, pt1.y/2+pt2.y/2, newbuf, i);
        }
        pt1 = toints(buf, oldpts-1);
        log(0, "lastpoint was " + sys.inspect(pt1));
        writeval(pt1.x, pt1.y, newbuf, newpts-1);
    },
    //maximum
    "max": function(buf, oldpts, newpts, newbuf) {
        var pt1 = null;
        var pt2 = null;
        for (var i = 0; i < newpts-1; ++i) {
            pt1 = toints(buf, i*2);
            pt2 = toints(buf, i*2+1);
            writeval(pt1.x/2+pt2.x/2, Math.max(pt1.y, pt2.y), newbuf, i);
        }
        pt1 = toints(buf, oldpts-1);
        writeval(pt1.x, pt1.y, newbuf, newpts-1);       
    }
};

/**
 * Compute an aggregate. For now, just do sampling at halfway points
 * @param next continuation(buffer)
 */
exports.TStore.prototype.computeAggregate = function(next) {
    var self = this;
    self.readBuf(function(buf) {
        log(0, "Computing aggregate of " + buf.length + " bytes");
        var oldpts = getlen(buf);
        var newpts = Math.ceil(oldpts/2);
        var newbuf = new Buffer(newpts*8);
        aggregates["mean"](buf, oldpts, newpts, newbuf);
        log(0, "Done computing aggregate of " + newbuf.length + " bytes");
        next(newbuf);
    });
};

/**
 * Close up the tstore
 * @param next continuation()
 */
exports.TStore.prototype.close = function(next) {
    var self = this;
    
    self.wait(self.wBusy, function() {
        self.wait(self.wOpen, function() {
            self.closed = true;
            self.gs.close(function(err, doc) {
                log(0, "Closed gridstore " + self.fullname);
                exports.getcoll(COLL_FS, function(err, coll) {
                    coll.update({"filename": self.fullname},
                                {$set: {"metadata.minx": self.minx,
                                        "metadata.maxx": self.maxx}},
                                function(err) {
                                    log(0, "Updated trange on TStore");
                                    next();
                                });
                });
            });
        });
    });
}

//more useful stuff:
// https://github.com/gatesvp/cloudfoundry_node_mongodb/blob/master/app.js.4