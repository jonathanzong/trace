'use strict';

// socket config
var incomingPort = 3333;
var connect_to_this_ip = '127.0.0.1';
var outgoingPort = 3334;

// LMA state
// default/resting values shown
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

// bot state
var agent = {
  pos: null,
  v: null,
  w: 0,
  d: 2 // depth/diameter
}

// perlin state
var p = 0;
var pstep = 0.0001;

// time control
var lastMove = 0;
var millisToUpdate = 100;

// unit vectors
var normals;

var sliders = [];
var labels = ["space", "weight", "time", "flow", "horizontal", "vertical", "sagittal", "reach"];

function setup() {
  createCanvas(windowWidth, windowHeight);
  stroke(100);
  angleMode(RADIANS);
  agent.pos = createVector(width / 2, height / 2);
  agent.v = p5.Vector.random2D();

  normals = {
    x: createVector(1, 0),
    y: createVector(0, 1),
    nx: createVector(-1, 0),
    ny: createVector(0, -1)
  }

  setupOsc(incomingPort, outgoingPort, connect_to_this_ip);

  for (var i = 0; i < 8; i++) {
    sliders[i] = createSlider(0, 10, 5);
    sliders[i].position(20, 20 * (i + 1));
    text(labels[i], 165, 20 * i + 30);
  }
}

function draw() {
  // update machine state
  LMA.effort.space = sliders[0].value() / 10;
  LMA.effort.weight = sliders[1].value() / 10;
  LMA.effort.time = sliders[2].value() / 10;
  LMA.effort.flow = sliders[3].value() / 10;
  LMA.shape.x = sliders[4].value() / 10;
  LMA.shape.y = sliders[5].value() / 10;
  LMA.shape.z = sliders[6].value() / 10;
  LMA.space.reach = sliders[7].value() / 10;

  // map update rate to Time
  millisToUpdate = Math.pow(1 - LMA.effort.time, 4) * 500;

  if (millis() - lastMove < millisToUpdate) return;
  lastMove = millis();

  // update depth using Weight and z of Shape
  agent.d = 5 * (LMA.effort.weight + LMA.shape.z) + 1;

  // update rotational speed
  // interpolation of w and pstep with Space, then divide by Reach
  agent.w = Math.pow(1 - LMA.effort.space, 2) * (noise((1 - LMA.effort.space) * pstep * p++) - 0.5) / (5 * (LMA.space.reach + 0.1));

  // update velocity direction
  agent.v.rotate(agent.w);

  // update velocity magnitude with Flow
  agent.v.setMag(LMA.effort.flow + 0.5);

  // boundary repulsion (inverse square) (TODO making me sad because it's clockwise only)
  agent.v.rotate(p5.Vector.angleBetween(agent.v, normals.x) / Math.pow(agent.pos.x + 1, 2));
  agent.v.rotate(p5.Vector.angleBetween(agent.v, normals.nx) / Math.pow(width - agent.pos.x + 1, 2));
  agent.v.rotate(p5.Vector.angleBetween(agent.v, normals.y) / Math.pow(agent.pos.y + 1, 2));
  agent.v.rotate(p5.Vector.angleBetween(agent.v, normals.ny) / Math.pow(height - agent.pos.y + 1, 2));
  
  // store position for drawing
  var x = agent.pos.x;
  var y = agent.pos.y;

  // update position
  // stretch velocity with x, y of Shape
  // TODO make sure this changes smoothly
  agent.pos.x += (0.5 + LMA.shape.x) * agent.v.x;
  agent.pos.y += (0.5 + LMA.shape.y) * agent.v.y;

  // boundary constraint
  agent.pos.x = constrain(agent.pos.x, 0, width);
  agent.pos.y = constrain(agent.pos.y, 0, height);

  // draw
  strokeWeight(agent.d);
  line(x, y, agent.pos.x, agent.pos.y);
}

function receiveOsc(address, value) {
  console.log("received OSC: " + address + ", " + value);

  address = address.split('/');

  if (address[1] == 'LMA') {
    LMA[address[2]][address[3]] = value;
  }

  sliders[0].value(LMA.effort.space * 10);
}
