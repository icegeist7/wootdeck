// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {animationFrame,animationDuration} from "../../src/animation.js";
import {captureDesign} from "../../src/presets.js";

const old='<svg xmlns="http://www.w3.org/2000/svg"><text>Old</text></svg>';
const next='<svg xmlns="http://www.w3.org/2000/svg"><text>New</text></svg>';
test("fade transitions cover both halves, do not delay state, and finish",()=>{
  const options={animation:"fade",animationDuration:400};
  let frame=animationFrame(undefined,old,"old",options,0,0);
  assert.equal(frame.image,old);
  frame=animationFrame(frame.state,next,"new",options,1,100);
  assert.equal(frame.state.current,next);
  assert.ok(frame.image.includes('Old') && frame.image.includes('opacity="1.000"'));
  frame=animationFrame(frame.state,next,"new",options,1,200);
  assert.ok(frame.image.includes('Old') && frame.image.includes('opacity="0.500"'));
  frame=animationFrame(frame.state,next,"new",options,1,400);
  assert.ok(frame.image.includes('New') && frame.image.includes('opacity="0.500"'));
  frame=animationFrame(frame.state,next,"new",options,1,500);
  assert.equal(frame.image,next);
  assert.equal(frame.state.from,undefined);
});

test("live values and rapid semantic updates cannot restart an animation forever",()=>{
  const options={animation:"fade",animationDuration:400};
  let frame=animationFrame(undefined,old,"idle",options,0,0);
  frame=animationFrame(frame.state,next,"pressed",options,0,100);
  const latest='<svg><text>Latest</text></svg>';
  frame=animationFrame(frame.state,latest,"other-key",options,1,250);
  assert.equal(frame.state.started,100);
  frame=animationFrame(frame.state,latest,"other-key",options,1,500);
  assert.equal(frame.image,latest);
  frame=animationFrame(frame.state,next,"other-key",options,1,550);
  assert.equal(frame.image,next,'Different depth/spinner SVG with the same state stays live');
});

test("crossfade, disabled transitions, and individual triggers behave independently",()=>{
  const base=animationFrame(undefined,old,"old",{},0,0).state;
  const cross=animationFrame(base,next,"new",{animation:"crossfade"},0,100);
  assert.ok(cross.image.includes('Old') && cross.image.includes('New'));
  assert.equal((cross.image.match(/<svg\b/g)||[]).length,1,'No nested SVG viewports');
  assert.ok(animationFrame(base,next,"new",{},1,100).image.includes('data-animation="crossfade"'));
  assert.equal(animationFrame(base,next,"new",{animation:"none"},1,100).image,next);
  assert.equal(animationFrame(base,next,"new",{animation:"fade",animateState:false,animatePress:false},1,100).image,next);
  assert.ok(animationFrame(base,old,"old",{animation:"fade",animateState:false,animatePress:true},1,100).state.from);
  assert.equal(animationDuration({animationDuration:9999}),1500);
  assert.equal(animationDuration({animationDuration:NaN}),200);
  assert.equal(captureDesign({animation:"crossfade",animationDuration:600,animatePress:false}).animationDuration,600);
});
