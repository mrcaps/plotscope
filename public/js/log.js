/**
 * Common simple logger
 * @author ishafer
 */
var sys = require('sys');

this.getLogger = function(loglevel) {
    return function(lvl) {
        if (lvl >= loglevel) {
            console.log.apply(console, Array.prototype.slice.call(arguments,1));
        }
    };
};