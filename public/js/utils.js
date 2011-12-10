/**
 * Common simple utilities
 * @author ishafer
 */
var sys = require('sys');

this.curms = function() {
    return (new Date()).getTime();
}

/**
 * Log base 2
 */
this.log2 = function(n) {
    return Math.log(n) / Math.log(2);
}