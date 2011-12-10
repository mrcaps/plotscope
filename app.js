/**
 * Main application controller
 * @author ishafer
 */
require.paths.unshift("./node_modules");
require.paths.unshift("./public/js");
require.paths.unshift(".");

var sys = require("sys"),
    express = require("express"),
    db = require("mydb"),
    formidable = require("formidable"),
    log = require("log").getLogger(0),
    utils = require("utils");
    
String.prototype.endsWith = function(suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1;
};
    
var app = express.createServer();
app.use(express.cookieParser());
app.use(express.session({secret: "proud in the cloud foundry"}));
app.use(app.router);
app.use(express.static(__dirname + "/public"));

app.configure(function() {
    app.set("views", __dirname + "/tmpl");
});

/**
 * Bind a closure for pagename context
 * @param pname the name of the page
 */
var context = function(pname) {
    return {
        pagename: pname,
        selif: function(name) {
            return (pname==name) ? "sel" : "";
        }
    }
}
app.get("/", function(req, res) {
    res.render("index.ejs", {c: context("home")});
});
app.get("/about", function(req, res) {
    res.render("about.ejs", {c: context("about")});
});
app.get("/demo", function(req, res) {
    res.render("demo.ejs", {c: context("demo")});
});

function die(res, obj) {
    res.contentType("application/json");
    res.send(obj);
}

/**
 * Only do next if user is logged in.
 */
function requireLogin(req, res, next) {
    if (req.session && (req.session.loggedin === true)) {
        next();
    } else {
        die(res, {"error": "login required"})
    }
}

var LOGIN_KEY = "frabjousfling";
app.get("/login/:key", function(req, res) {
    if (req.session) {
        if (req.params.key == LOGIN_KEY) {
            req.session.loggedin = true;
            die(res, {"message":"logged in!"});
        } else {
            die(res, {"error":"incorrect key."});
        }
    } else {
        die(res, {"error":"couldn't log you in"})
    }
});

app.get("/logout", function(req, res) {
    var next = function(err) {
        if (err) {
            die(res, {"error":"Couldn't log you out"});
        } else {
            die(res, {"message":"logged out"});
        }
    };
    
    if (!req.session) {
        next("No session");
    } else {
        req.session.destroy(next);
    }
});

/**
 * Debugging information about database
 */
app.get("/db/info", requireLogin, function(req, res) {
    res.write(db.mongourl+"\n");
    res.write(JSON.stringify(db.mongo)+"\n\n");
    res.write(JSON.stringify(process.env.VCAP_SERVICES)+"\n");
    res.end("\n");
});

//TODO: add cache eviction
var tscache = {};
var INFLIGHT = "inflight";
//should the app worker cache results from the database?
var workercaching = true;
function hashnameTS(name, level) {
    return name + "." + level;
}
function getTSBuf(name, level, next) {
    var n = hashnameTS(name, level);
    if (tscache[n] && workercaching) {
        //use strict comparison!
        if (tscache[n] === INFLIGHT) {
            log(0, "Inflight hit for ts " + n);
            var waitreq = function(next) {
                if (tscache[n] === INFLIGHT) {
                    setTimeout(function() {return waitreq(next);}, 50);
                } else {
                    next(tscache[n]);
                }
            }
        } else {
            log(0, "Cache hit for ts " + n);
            next(tscache[n]);
        }
    } else {
        log(0, "Cache miss for ts " + n);
        if (workercaching) { tscache[n] = INFLIGHT; }
        var ts = new db.TStore(name, level, {mode: "r"}, function() {
            log(1, "Requesting TStore name=" + name + " level=" + level);
            ts.readBuf(function(buf) {
                if (workercaching) { tscache[n] = buf; }
                next(buf);
            });
        });
    }
}

/**
 * Obtain time range.
 * Query params:
 *  name: timeseries name
 *  level: zoom level
 *  lbnd: lower x (time) bound
 *  hbnd: upper x (time) bound
 */
app.get("/db/get", function(req, res) {
    var pname = req.query.name,
        plevel = req.query.level,
        plbnd = req.query.lbnd,
        phbnd = req.query.hbnd;
    var t1 = utils.curms();
    
    getTSBuf(pname, plevel, function(buf) {
        var i = 0;
        
        var lo = Math.abs(db.binSearch(buf, plbnd));
        var hi = Math.abs(db.binSearch(buf, phbnd));
        
        log(0, "Got bounds lo=" + lo + " hi=" + hi + " of " + buf.length/8);
        
        log(0, ((new Date()).getTime()-t1) + "ms -> pull");
        //using the inbuilt stringify is much faster.
        var arr = db.toArray(buf, lo, hi);
        log(0, ((new Date()).getTime()-t1) + "ms -> retrieve");
        res.end(JSON.stringify(arr));
        log(0, ((new Date()).getTime()-t1) + "ms -> finish");
        
        //writing out a response manually is very expensive
        /*
        res.write("[");
        while (i < buf.length) {
            res.write("{"x":");
            res.write(""+(buf[i++] | buf[i++]<<8 | buf[i++]<<16 | buf[i++]<<24));
            res.write(","y":");
            res.write(""+(buf[i++] | buf[i++]<<8 | buf[i++]<<16 | buf[i++]<<24));
            res.write("},\n");
        }
        res.end("]");
        */
    });
});

var MINLENGTH = 1000;
/**
 * Create aggregates for the given sfile
 * Produces all aggregates from the given level down until length is below MINLENGTH
 * @param sfile file to compute aggs for. Must have been opened for read.
 * @param next continuation
 */
function createAggregates(sfile, next) {
    sfile.computeAggregate(function(buf) {
        //make the new tstore with an incremented level
        var lvl = sfile.getLevel();
        var newf = new db.TStore(
            sfile.getName(),
            lvl+1,
            {mode: "w"},
            function() {
                log(0, "Writing aggregate @ lvl " + lvl);
                newf.writeBuf(buf, function() {
                    newf.reopen("r", function(reopenedf) {
                        //continue aggregating if we're above the min length
                        if (buf.length > MINLENGTH) {
                            createAggregates(reopenedf, next);
                        } else {
                            next();
                        }
                    });
                });
            });
    });
}

/**
 * Compute aggregates for the given name.
 */
app.get("/db/agg/:name", function(req, res) {
    log(0, "Starting to aggregate");
    var sfile = new db.TStore(req.params.name, 0, {mode: "r"}, function() {
        createAggregates(sfile, function() {
            log(0, "Done creating aggregates");
            res.end(JSON.stringify({"msg": "Done creating aggregates"})); 
        });
    });
});

/**
 * List all level 0 timeseries files and metadata
 */
app.get("/db/list", function(req, res) {
    var jsres = {};
    db.getFileInfo({}, function(lst) {
        lst.forEach(function(el) {
            if (el.filename.endsWith(".0")) {
                var name = el.filename.substring(0, el.filename.length-2);
                jsres[name] = {
                    name: name,
                    points: el.length/8,
                    metadata: el.metadata
                };
            }
        });
        res.end(JSON.stringify(jsres));
    });
})

/**
 * Render timeseries upload page
 */
app.get("/db/add/:name/:scale", function(req, res) {
   res.render("upload.ejs", {c: context("upload")});
});
/**
 * Postback for timeseries upload page
 */
app.post("/db/add/:name/:scale", function(req, res) {
    var form = new formidable.IncomingForm();
    var pname = req.params.name;
    
    //save file
    var sfile = new db.TStore(pname, 0, {
        mode: "w",
        metadata: {
            "scale": req.params.scale
        }
    }, function() {});

    var obtained = 0;

    form.onPart = function(part) {
        part.addListener("data", function(chunk) {
            log(0, "Rcv chunk len=" + chunk.length);
            obtained += chunk.length;
            sfile.writeBuf(chunk, function() {
               log(0, "RcvWrote chunk len=" + chunk.length); 
            });
        });
        part.addListener("end", function() {
            log(0, "Finished stream; closing files; total now " + obtained);
            sfile.close(function() {
                res.end(JSON.stringify({"msg": "Received file " + pname}));
            });
        });
    };
    
    //we must begin parsing immediately.
    //the defensive locking on TStores keeps this safe.
    form.parse(req);
});

var myport = process.env.VMC_APP_PORT || 3000;
app.listen(myport);
sys.puts("Server running on port " + myport);