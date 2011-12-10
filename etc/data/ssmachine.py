#!/usr/bin/python

#Convert ss machine dataformat into OpenTSDB import format
import sys, argparse, struct

METRICS = \
    ['ss.load', 'ss.procs', \
     'ss.rxbyte', 'ss.txbyte', 'ss.rxpkt', 'ss.txpkt', \
     'ss.disk0', 'ss.disk1', 'ss.disk2', 'ss.disk3', 'ss.disk4', 'ss.disk5', 'ss.disk6', \
     'ss.mem', \
     'ss.users']

#we expect a line like:
#host ss8 dat 1167917461 AN 0.12 52 NET 75048 35590 751 352 DISK 10 235 940 62 920 4438 0 CORE 63616 US 0 END
#l: the line
#outpt: output stream
#lastts: last timestamp
def parse(l, outpt, lastts):
    larr = l.split()
    dx = 0
    host = ''
    ts = ''
    
    if larr[dx] != 'host':
        return lastts
    dx += 1
    
    if larr[dx] != 'dat':
        host = larr[dx]
        dx += 1
    else:
        return lastts
    if larr[dx] != 'dat':
        return lastts
    dx += 1
        
    if larr[dx] != 'AN':
        ts = larr[dx]
        if long(lastts) >= long(ts):
            print >> sys.stderr, "WARN: skipping line due to non-positive timestamp delta: " + l
            return ts
        dx += 1
    else:
        return
    if larr[dx] != 'AN':
        return
    dx += 1
    
    if OFORMAT == FMT_BIN:
        outpt.write(struct.pack("i", int(ts)))
    
    if OFORMAT == FMT_TSDB:
        def wmetric(name):
            outpt.write('%s %s %s host=%s\n' % (name, ts, larr[dx], host))
        def wmetricend(name):
            wmetric(name)
    elif OFORMAT == FMT_BIN:
        def wmetric(name):
            if larr[dx].find(".") > -1:
                #XXX: scale factor of 100 for now for floating-point data
                v = int(float(larr[dx])*100)
            else:
                v = int(larr[dx])
            try:
                outpt.write(struct.pack("i", v))
            except:
                print "Invalid value: " + larr[dx] + " on line: " + " ".join(larr)
                outpt.write(struct.pack("i", 0))
        def wmetricend(name):
            wmetric(name)
    elif OFORMAT == FMT_CSV:
        def wmetric(name):
            outpt.write('%s,' % larr[dx])
        def wmetricend(name):
            outpt.write('%s\n' % larr[dx])
    
    if larr[dx] != 'NET':
        for i in xrange(0,2):
            wmetric(METRICS[i]); dx += 1
    if larr[dx] != 'NET':
        if OFORMAT == FMT_TSDB:
            return
        elif OFORMAT == FMT_BIN or OFORMAT == FMT_CSV:
            wmetric(0); dx += 1
    dx += 1
    
    if larr[dx] != 'DISK':
        for i in xrange(2,6):
            wmetric(METRICS[i]); dx += 1
    if larr[dx] != 'DISK':
        if OFORMAT == FMT_TSDB:
            return
        elif OFORMAT == FMT_BIN or OFORMAT == FMT_CSV:
            wmetric(0); dx += 1
    dx += 1
    
    if larr[dx] != 'CORE':
        for i in xrange(6,13):
            wmetric(METRICS[i]); dx += 1
    if larr[dx] != 'CORE':
        if OFORMAT == FMT_TSDB:
            return
        elif OFORMAT == FMT_BIN:
            wmetric(0); dx += 1
    dx += 1
    
    if larr[dx] != 'US':
        wmetric(METRICS[13]); dx += 1
    if larr[dx] != 'US':
        if OFORMAT == FMT_TSDB:
            return
        elif OFORMAT == FMT_BIN or OFORMAT == FMT_CSV:
            wmetric(0); dx += 1
    dx += 1
    
    if larr[dx] != 'END':
        wmetricend(METRICS[14]); dx += 1
    else:
        if OFORMAT == FMT_TSDB:
            return
        elif OFORMAT == FMT_BIN or OFORMAT == FMT_CSV:
            wmetricend(0); dx += 1
        
    return ts

def run(inpt, outpt):
    lastts = 0
    while True:
        s = inpt.readline()
        if not s:
            break
            
        lastts = parse(s, outpt, lastts)

FMT_TSDB = 'tsdb'
FMT_BIN = 'bin'
FMT_CSV = 'csv'
OFORMAT = FMT_TSDB

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Parse SS machine logs")
    parser.add_argument('format', 
        metavar='format', 
        type=str, 
        choices=[FMT_TSDB, FMT_BIN, FMT_CSV],
        help='format: tsdb, bin, csv')
    parser.add_argument('output',
        metavar='output',
        type=str,
        help='output file')
    parser.add_argument('--listmetrics', 
        dest='dolist', 
        action='store_const', 
        const=True)
    
    args = parser.parse_args()
    if args.dolist:
        print " ".join(METRICS)
        sys.exit(0)
    OFORMAT = args.format
    
    fdout = open(args.output, 'wb')
    run(sys.stdin, fdout)
    fdout.close()