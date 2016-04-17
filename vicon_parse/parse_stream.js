'use strict';

var osc = require('osc');

// Create an osc.js UDP Port listening on port 57121.
var udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 57121
});

// Open the socket.
udpPort.open();

var spawn = require('child_process').spawn;
var stream = spawn('./ViconDataStreamSDK_CPPTest', ['169.254.215.174:801']);

var SAMPLE_SIZE = 20;

var positions = {};
var velocities = {};
var accelerations = {};

// param: name (string), positon (array3)
function updateTracking(name, position) {
  // initialize
  if (!positions[name]) {
    positions[name] = [];
  }
  if (!velocities[name]) {
    velocities[name] = [];
  }
  if (!accelerations[name]) {
    accelerations[name] = [];
  }
  var pn = positions[name];
  var vn = velocities[name];
  var an = accelerations[name];
  // update
  pn.push(position);
  if (pn.length >= 2) {
    vn.push(sub(copy(pn[pn.length - 1]), pn[pn.length - 2]));
  }
  if (vn.length >= 2) {
    an.push(sub(copy(vn[vn.length - 1]), vn[vn.length - 2]));
  }
  // delete oldest
  while (pn.length > SAMPLE_SIZE) {
    pn.shift();
  }
  while (vn.length > SAMPLE_SIZE) {
    vn.shift();
  }
  while (an.length > SAMPLE_SIZE) {
    an.shift();
  }
}

var LMA = {
  effort: {
    space: 0.5, // [indirect, direct]
    weight: 0.5, // [light, strong]
    time: 0.5, // [sustained, sudden]
    flow: 0.5 // [free, bound]
  }, // in [0, 1]
  shape: {
    x: 0.5, // horizontal [enclosing, spreading]
    y: 0.5, // vertical [sinking, rising]
    z: 0.5 // sagittal [retreating, advancing]
  }, // in [0, 1]
  space: {
    reach: 0.5 // near/mid/far in [0, 1]
  }
}

var dot = require('vectors/dot')(3);
var add = require('vectors/add')(3);
var sub = require('vectors/sub')(3);
var div = require('vectors/div')(3);
var copy = require('vectors/copy')(3);
var mag = require('vectors/mag')(3);

// function avg(vecs) {
//   if (vecs && vecs.length) {
//     var sum = [0, 0, 0];
//     for (var i = 0; i < vecs.length; i++) {
//       add(sum, vecs[i]);
//     }
//     div(sum, vecs.length);
//     return sum;
//   }
//   return vecs;
// }

function avg(arr) {
  if (arr.length) {
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    sum /= arr.length;
    return sum;
  }
  return 0;
}

function updateLMA() {

  // LMA.effort.space
  var njoints = Object.keys(velocities).length;
  if (njoints) {
    var vcosines = 0;
    for (var joint in velocities) {
      if (!velocities.hasOwnProperty(joint)) continue;
      var samples = velocities[joint];
      if (samples.length >= 2) {
        var jcosines = [];
        for (var i = 0; i < samples.length - 1; i++) {
          var cosine = dot(copy(samples[i]), samples[i + 1]) / (mag(samples[i]) * mag(samples[i + 1]));
          if (cosine)
            jcosines.push((cosine + 1) / 2);
        }
        var jcosine = avg(jcosines);
        vcosines += jcosine;
      }
    }
    vcosines /= njoints;
    LMA.effort.space = vcosines;
  }
  
  for (var i in LMA) {
    for (var j in LMA[i]) {
      // Send an OSC message to localhost:3333
      udpPort.send({
        address: "/LMA/" + i + "/" + j,
        args: [LMA[i][j]]
      }, "127.0.0.1", 3333);
    }
  }
}

var buffer = '';
var re = /Segment #\d\s+Name:\s(\w+)[^G]*Global Translation:\s\((.*)\)/;

// magic spaghetti
stream.stdout.on('data', function(data) {
  buffer += data.toString();
  var indexStart = buffer.indexOf('Subject');
  var indexEnd = buffer.indexOf('Marker #0', indexStart);
  while (indexStart >= 0 && indexEnd > indexStart) {
    var subjects = buffer.split('Subject');
    if (subjects.length > 1) {
      while (subjects.length && subjects[0].indexOf('Marker #0') < 0) subjects.shift();
      if (subjects.length) {
        var subject = subjects.shift();
        buffer = subjects.join('Subject'); // put the partial back into the buffer
        var matches = subject.match(re);
        var name = matches[1].toString().trim();
        var position = matches[2].toString().split(', ').map(function(d) {return parseInt(d);});
        updateTracking(name, position);
      }
    }
    else {
      break;
    }
    indexStart = buffer.indexOf('Subject');
    indexEnd = buffer.indexOf('Marker #0');
  }

  updateLMA();
});

console.log('hello');