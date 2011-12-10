/**
 * Generate some sample binary data
 * @author ishafer
 */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

#define log(fmt, ...) fprintf(stderr, fmt, __VA_ARGS__)

//a few data generators
int sawtooth(int i) { return ((i*20) + rand() % 10) % 3500; }
int monotone(int i) { return i/60; }
int sines(int i) {
    double t = ((double) i) / 160000.0;
    return (int) (
        sin(t)*1500.0 +
        sin(t*40.0)*1000.0 +
        sin(t*500.0)*800.0 +
        (rand()%100)*2.0 +
        2000.0f);
}

typedef int (*genfn)(int);
genfn genfns[] = {sawtooth, monotone, sines};
int MAX_GEN_FN = sizeof(genfns)/sizeof(genfn);

void usage(char** argv) {
    printf("Usage: %s genfn length\n", argv[0]);
    printf("  genfn: generator function index (0-%d)\n", MAX_GEN_FN-1);
    printf("  length: number of datapoints\n");
}

/**
 * @param fnno index of the generator function
 * @param nlines number of datapoints to write
 */
void write(int fnno, int nlines) {
    int i;
    int curts = 0x4654F382; //82 F3 54 46;
    char* pcurts = (char*) &curts;
    int val = 0;
    char* pval = (char*) &val;
    genfn gen = genfns[fnno];
    
    for (i = 0; i < nlines; ++i) {
        val = gen(i);
        curts += 100;
        
        //format is simple: 4 bytes of timestamp followed by 4 bytes of value
        //  timestamp: signed integer, number of seconds since the epoch
        //  value: signed integer
        printf("%c%c%c%c", pcurts[0], pcurts[1], pcurts[2], pcurts[3]);
        printf("%c%c%c%c", pval[0], pval[1], pval[2], pval[3]);
    }
}

int main(int argc, char** argv) {
    int genfn, nlines;
    
    if (argc != 3)  {
        usage(argv);
        return 1;
    }
    
    genfn = atoi(argv[1]);
    nlines = atoi(argv[2]);
    if (genfn > MAX_GEN_FN - 1) {
        usage(argv);
        return 1;
    }
    log("Starting up with genfn=%d lines=%d\n", genfn, nlines);
    
    write(genfn, nlines);
}