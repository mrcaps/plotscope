/**
 * Test time for db->workercache->buffer and workercache->buffer
 */
require.paths.unshift('../node_modules');
require.paths.unshift('../public/js');
require.paths.unshift('../');

var sys = require('sys'),
    express = require('express'),
    db = require('mydb'),
    formidable = require('formidable'),
    log = require('log').getLogger(0),
    utils = require('utils');
    
var tscache = {};

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
        //this was the slow bit - cache lookups should not have been slow.
        //triple equals is important - we don't want to compare the buffer!
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
        var ts = new db.TStore(name, level, "r", function() {
            log(1, "Requesting TStore name=" + name + " level=" + level);
            ts.readBuf(function(buf) {
                if (workercaching) { tscache[n] = buf; }
                next(buf);
            });
        });
    }
}

//which data series should we test on?
var DATANAME = "foo";
function timereq(level, next) {
    var start = utils.curms();
    getTSBuf(DATANAME, level, function() {
        var t = utils.curms() - start;
        log(0, "Got level " + level + " in " + t + " ms");
        next();
    });
}

function test() {
    var ltest = 0;
    
    timereq(ltest, function() {
        setTimeout(function() {
            timereq(ltest, function(){});
        }, 100);
    });
}

setTimeout(test, 1000);