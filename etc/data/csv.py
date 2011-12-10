#!/usr/bin/python
import sys, argparse, struct, time

#return an int representation
def fmt_default(s):
    return int(s)
#year-month-date formatter
def fmt_ymd(s):
    return int(time.mktime(time.strptime(s,"%Y-%m-%d")) - time.timezone)
#multiply floating-point by a value
def fmt_mult(s, val):
    return int(float(s)*val)

#colspec: column spec (see help)
#headertoks: tokenized header
def parsecols(colspec, headertoks):
    splt = [c.split(":") for c in colspec]
    parsed = []
    
    for v in splt:
        assert 2 <= len(v)
        fn = fmt_default
        
        if v[1] == 'ymd':
            fn = fmt_ymd
        elif v[1].startswith('mult'):
            fn = lambda s: fmt_mult(s, int(v[2]))
        elif v[1] == 'int':
            fn = fmt_default
        else:
            print >> sys.stderr, "unknown output format" + ":".join(v)
            
        col = int(v[0])
        parsed.append((col, fn, headertoks[col]))
        
    return parsed

#inpt: input stream
#outpt: output stream
#cols: columns to select
#sep: column separator
def run(inpt, outpt, cols, separator):
    header = inpt.readline()[:-1]
    pcols = parsecols(cols, header.split(separator))
    print >> sys.stderr, "parsed spec was: "
    print >> sys.stderr, pcols
    
    while True:
        line = inpt.readline()[:-1]
        if not line:
            break
            
        splt = line.split(separator)
        
        vs = [(col[1](splt[col[0]]), col[2]) for col in pcols]
        
        if OFORMAT == FMT_TSDB:
            for v in vs[1:]:
                outpt.write('%s %s %s\n' % (v[1], vs[0][0], v[0]))
        elif OFORMAT == FMT_BIN:
            for v in vs:
                outpt.write(struct.pack("i", int(v[0])))
            

FMT_TSDB = 'tsdb'
FMT_BIN = 'bin'
OFORMAT = FMT_TSDB

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Parse regular CSV data")
    parser.add_argument('format', 
        metavar='format', 
        type=str, 
        choices=[FMT_TSDB, FMT_BIN],
        help='format: tsdb or bin (currently ignored; only bin supported)')
    parser.add_argument('output',
        metavar='output',
        type=str,
        help='output file')
    parser.add_argument('columns',
        metavar='C',
        type=str,
        nargs='+',
        help='''Columns to select from the file (first should be timestamp).
        The format is <colno>:<formatter> where <colno> is an int and <formatter>
        is a predefined formatter that will convert the value to an output int.
        Additional arguments to the formatter are separated by colons.''')
    
    args = parser.parse_args()
    OFORMAT = args.format
    
    fdout = open(args.output, 'wb')
    run(sys.stdin, fdout, args.columns, ",")
    fdout.close()
