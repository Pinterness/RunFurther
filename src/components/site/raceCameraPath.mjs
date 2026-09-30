import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

const clamp = value => MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const roadX = z => Math.sin(-z / 29) * 8;
export const JOURNEY_STOPS = [0, .25, .47, .71, 1];

// Ground waypoints keep the runner on the road, apart from station approaches.
const route = [
  [0, [0, 0, 8]], [.025, [roadX(2), 0, 2]], [.10, [roadX(-10), 0, -10]],
  [.18, [roadX(-25), 0, -25]], [.225, [9.3, 0, -31]], [.25, [11, 0, -34]],
  [.267, [8.3, 0, -35.1]], [.29, [roadX(-42), 0, -42]], [.36, [roadX(-53), 0, -53]],
  [.47, [roadX(-68), 0, -68]], [.56, [roadX(-82), 0, -82]],
  [.65, [roadX(-94), 0, -94]], [.71, [1.5, 0, -100]],
  [.735, [-2.3, 0, -100.8]], [.765, [roadX(-111), 0, -111]], [.86, [roadX(-128), 0, -128]],
  [.96, [roadX(-145), 0, -145]], [1, [-7.3, 0, -153]],
];

// Camera offsets use the runner's frame, so moving shots keep their subject.
// Positive Z is behind the runner; negative Z gives a front-facing shot.
const shots = [
  [0, [0, 1.68, 0]], [.025, [0, 1.70, .15]], [.075, [.3, 2.8, 4.5]],
  [.14, [1.1, 3.4, 6.5]], [.21, [4.5, 2.7, 4]], [.25, [3.8, 2.4, 3.7]],
  [.30, [5.5, 4.5, 5]], [.38, [9, 19, 9]], [.47, [12, 48, 6]],
  [.55, [-9, 19, 9]], [.62, [-4, 5, 6]], [.68, [2, 3.2, 5]],
  [.71, [4.5, 2.8, -1.5]], [.765, [-4.2, 3.2, -2.5]],
  [.82, [-3.5, 3.5, 5]], [.90, [1.5, 3.3, 6]], [.95, [4.5, 2.9, 1]],
  [.975, [3.8, 2.6, -3.5]], [1, [.8, 2.35, -5]],
];

// Chapter times map to arc-length boundaries: stop positions remain exact,
// independent of curve parameterization, frame rate and scroll direction.
function timedCurve(points) {
  const curve = new CatmullRomCurve3(points.map(([, point]) => new Vector3(...point)), false, 'centripetal');
  const divisions = 256;
  curve.arcLengthDivisions = (points.length - 1) * divisions;
  const lengths = curve.getLengths(), length = lengths.at(-1);
  const stops = points.map(([at], index) => ({ at, distance: lengths[index * divisions] / length }));
  function distanceAt(value) {
    const progress = clamp(value);
    const index = stops.findIndex(stop => stop.at >= progress);
    if (index <= 0) return index === 0 ? 0 : 1;
    const before = stops[index - 1], after = stops[index];
    return MathUtils.lerp(before.distance, after.distance, (progress - before.at) / (after.at - before.at));
  }
  return { curve, stops, distanceAt };
}

export function createRaceCameraPath() {
  const routePath = timedCurve(route), cameraPath = timedCurve(shots);
  const actorPosition = new Vector3(), forward = new Vector3(), offset = new Vector3();
  const right = new Vector3(), expectedHeading = new Vector3(), ahead = new Vector3();
  const pose = { position: null, lookAt: null, actorPosition, forward, mode: 'first-person', actorVisible: false };
  return {
    curve: cameraPath.curve,
    routeCurve: routePath.curve,
    cameraStops: JOURNEY_STOPS.map(progress => ({ time: progress * 100, progress })),
    sample(progress, position, lookAt) {
      const story = clamp(progress), distance = routePath.distanceAt(story);
      routePath.curve.getPointAt(distance, actorPosition);
      actorPosition.y = .17;
      routePath.curve.getTangentAt(distance, forward);
      forward.y = 0; forward.normalize();
      // Face the water table for the drink, then return to the trail.
      const waterWeight = smooth((story - .21) / .04) * (1 - smooth((story - .25) / .045));
      expectedHeading.set(1, 0, -2).normalize();
      forward.lerp(expectedHeading, waterWeight).normalize();
      const kitWeight = smooth((story - .67) / .04) * (1 - smooth((story - .71) / .04));
      forward.lerp(expectedHeading.set(0, 0, -1), kitWeight).normalize();
      forward.lerp(expectedHeading.set(0, 0, -1), smooth((story - .96) / .04)).normalize();
      right.set(-forward.z, 0, forward.x);

      cameraPath.curve.getPointAt(cameraPath.distanceAt(story), offset);
      position.copy(actorPosition).addScaledVector(right, offset.x).addScaledVector(forward, -offset.z);
      position.y += Math.max(1.6, offset.y);
      ahead.copy(actorPosition).addScaledVector(forward, 10); ahead.y += 1.65;
      lookAt.copy(actorPosition); lookAt.y += 1.08;
      lookAt.lerp(ahead, 1 - smooth((story - .025) / .055));
      pose.position = position; pose.lookAt = lookAt;
      pose.actorVisible = story > .045;
      pose.mode = story < .055 ? 'first-person' : story < .19 ? 'follow' : story < .31 ? 'water-side' : story < .60 ? 'aerial' : story < .82 ? 'kit-orbit' : 'finish-front';
      return pose;
    },
  };
}

