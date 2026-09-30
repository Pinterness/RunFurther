import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { createRaceCameraPath, JOURNEY_STOPS } from '../src/components/site/raceCameraPath.mjs';

test('the runner reaches every station on the ground', () => {
  const path=createRaceCameraPath(), position=new Vector3(), look=new Vector3();
  assert.deepEqual(JOURNEY_STOPS,[0,.25,.47,.71,1]);
  for(const [story,expected] of [
    [0,[0,.17,8]],[.25,[11,.17,-34]],
    [.47,[Math.sin(68/29)*8,.17,-68]],
    [.71,[1.5,.17,-100]],[1,[-7.3,.17,-153]],
  ]){
    const pose=path.sample(story,position,look);
    assert.ok(pose.actorPosition.distanceTo(new Vector3(...expected))<.001, `Missed station ${story}`);
  }
});

test('camera and actor follow continuous, finite, reversible paths without crossing the ground', () => {
  const path=createRaceCameraPath(), position=new Vector3(), look=new Vector3();
  const previousPosition=new Vector3(), previousActor=new Vector3(), previousDirection=new Vector3();
  const frames=[];
  for(let i=0;i<=10000;i++){
    const story=i/10000,pose=path.sample(story,position,look);
    assert.ok([...position,...look,...pose.actorPosition,...pose.forward].every(Number.isFinite));
    assert.ok(position.y>=1.77);
    assert.equal(pose.actorPosition.y,.17);
    assert.ok(position.distanceToSquared(look)>.2);
    assert.ok(Math.abs(pose.actorPosition.x-Math.sin(-pose.actorPosition.z/29)*8)<4.9,'Runner left the trail corridor');
    assert.ok(Math.hypot(pose.actorPosition.x-1.5,pose.actorPosition.z+103)>2.7,'Runner crossed the race-kit podium');
    if(Math.abs(pose.actorPosition.z+36)<.9)assert.ok(Math.abs(pose.actorPosition.x-12)>2.25,'Runner crossed the water table');
    const direction=look.clone().sub(position).normalize();
    if(i){
      assert.ok(position.distanceTo(previousPosition)<.15,`Camera jumped at ${story}`);
      assert.ok(pose.actorPosition.distanceTo(previousActor)<.04,`Actor jumped at ${story}`);
      assert.ok(direction.dot(previousDirection)>.999,`Camera turned abruptly at ${story}`);
    }
    previousPosition.copy(position);previousActor.copy(pose.actorPosition);previousDirection.copy(direction);
    if(i%100===0)frames.push({story,position:position.clone(),look:look.clone(),actor:pose.actorPosition.clone()});
  }
  for(const frame of frames.reverse()){
    const pose=path.sample(frame.story,position,look);
    assert.ok(position.equals(frame.position));assert.ok(look.equals(frame.look));
    assert.ok(pose.actorPosition.equals(frame.actor));
  }
});

test('shots move from first-person to visible action framing and an aerial map', () => {
  const path=createRaceCameraPath(), position=new Vector3(), look=new Vector3();
  let pose=path.sample(0,position,look);
  assert.equal(pose.mode,'first-person');assert.equal(pose.actorVisible,false);
  assert.ok(position.distanceTo(pose.actorPosition)<2);
  assert.ok(look.z<position.z);
  for(const [story,mode] of [[.12,'follow'],[.25,'water-side'],[.47,'aerial'],[.71,'kit-orbit'],[1,'finish-front']]){
    pose=path.sample(story,position,look);
    assert.equal(pose.mode,mode);assert.equal(pose.actorVisible,true);
    assert.ok(look.distanceTo(pose.actorPosition.clone().add(new Vector3(0,1.08,0)))<1e-8);
    if(story===.47)assert.ok(position.y>40);
    if([.25,.71,1].includes(story))assert.ok(position.distanceTo(pose.actorPosition)<6.5,'Action camera too far from runner');
  }
  assert.ok(position.z<pose.actorPosition.z,'Finish shot must show the medal on the front of the body');
});

test('invalid and overscrolled progress clamps to safe endpoints', () => {
  const path=createRaceCameraPath(), position=new Vector3(), look=new Vector3();
  for(const progress of [NaN,-1,undefined]){
    assert.deepEqual(path.sample(progress,position,look).actorPosition.toArray(),[0,.17,8]);
  }
  const pose=path.sample(2,position,look);
  assert.ok(pose.actorPosition.distanceTo(new Vector3(-7.3,.17,-153))<1e-8);
  assert.ok(position.distanceTo(look)>4);
});

