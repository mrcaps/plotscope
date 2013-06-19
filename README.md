# plotscope
A summer 2011 Cloud Foundry Fling

ishafer (mrcaps@gmail.com)

## Installation
plotscope requires node.js and MongoDB. You can `vmc push` to Cloud Foundry
(e.g. a [micro cloud](https://www.cloudfoundry.com/micro) running on your machine)
or run on your machine. Here's how to grab the dependencies for local use, as of 9/8/11.

### MongoDB
Generally, the [downloads page](http://www.mongodb.org/downloads) is helpful.

If you're on Debian or Ubuntu, I'd recommend using packages from the
[apt repos](http://www.mongodb.org/display/DOCS/Ubuntu+and+Debian+packages)

After the package is installed, `mongod` should start automatically.
If it doesn't, run `mongod`; the db shell is accessible as `mongo` for testing.

### node.js
The [installation page](https://github.com/joyent/node/wiki/Installation) is helpful here.
Beware that node is very in-flux, and building from a bleeding-edge version will probably
cause sadness. Plotscope has been tested on v0.10.12.

## Build/Run
Just do a
    
    node app.js
    
from this directory and the app should fire up on `http://localhost:3000`

## Adding Data
To add data, go to the upload page:

    http://localhost:3000/db/add/<name>/<scale>
    
where `<name>` is the name of the dataset you'd like to add and `<scale>` is
a scaling value for the data. The axes are currently hardcoded to have a maximum of
`YMAX = 1000000`; thus, if you have data between 0 and 1000, `<scale>`=1000 is a good choice.
The original data values/range will still be maintained, and the UI shows the actual scale on
multiple axes to the left of the plot.

One of the tiny sample data sets is in `etc/data/stock-vmw.bin` for testing this.

### Aggregation

After uploading, to build aggregates, go to

    http://localhost:3000/db/agg/<name>
    
where `<name>` was the name used for the upload. This creates the scaled views necessary for the UI.

### Data Format

Data is in a simple binary format of 8 byte datapoints: 4 byte timestamps and 4 byte values (little-endian)
with no header. Datafiles should look like

    [time0][data0][time1][data1][time2][data2]...

Some data sources of note:

* A little synthetic data creator is in `etc/synth`
* To convert from the format stored by the SS machines at the PDL, `etc/data/ssmachine.py` cleans them up and will spit out binary
* To convert from CSV or delimited format, there's `etc/data/csv.py`

## Contact
Surely there are bugs in both what's written above and in the app!
Contact mrcaps@gmail.com if/when "stuff breaks" :)