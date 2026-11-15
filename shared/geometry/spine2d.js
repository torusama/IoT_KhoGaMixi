// Cùng một file dùng được trong Node.js và trình duyệt.
(function (globalObject, createGeometryModule) {
  if (typeof module === 'object' && module.exports) {
    module.exports = createGeometryModule();
  } else {
    globalObject.Spine2D = createGeometryModule();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SENSOR_NAMES = ['P1', 'P2', 'P3', 'P4'];
  const RADIANS_PER_DEGREE = Math.PI / 180;

  // Ngưỡng 0.3 độ chỉ dùng thử nghiệm, chưa phải độ chính xác cảm biến.
  // Tên các trường cấu hình được giữ để tương thích các nơi gọi hàm hiện tại.
  const DEFAULT_OPTIONS = Object.freeze({
    epsilonDeg: 0.3,
    samplesPerSegment: 25,
    maxAngleChangeDeg: 90
  });

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /** Đưa chênh góc về [-180, 180). Ví dụ: -358 độ trở thành +2 độ. */
  function wrapDegrees(angleDegrees) {
    let normalizedAngleDegrees = angleDegrees % 360;
    if (normalizedAngleDegrees >= 180) {
      normalizedAngleDegrees -= 360;
    }
    if (normalizedAngleDegrees < -180) {
      normalizedAngleDegrees += 360;
    }
    return normalizedAngleDegrees;
  }

  function failure(errorCode, errorMessage) {
    return {
      valid: false,
      unit: null,
      points: null,
      relativeAnglesDeg: null,
      segments: [],
      curvePoints: [],
      totalLength: null,
      error: { code: errorCode, message: errorMessage }
    };
  }

  /** Trả null khi hợp lệ; nếu không, trả kết quả lỗi và không dựng hình. */
  function validateInput(input, options, settings) {
    if (!isObject(input)) {
      return failure('INVALID_SENSOR_FRAME', 'Expected a frame object.');
    }
    if (!isObject(options)) {
      return failure('INVALID_OPTIONS', 'Expected options object.');
    }

    const straightLineThresholdDegrees = settings.epsilonDeg;
    const maximumAngleChangeDegrees = settings.maxAngleChangeDeg;
    const sampleCount = settings.samplesPerSegment;
    if (!isFiniteNumber(straightLineThresholdDegrees) || straightLineThresholdDegrees < 0 ||
        !isFiniteNumber(maximumAngleChangeDegrees) || maximumAngleChangeDegrees <= 0 ||
        maximumAngleChangeDegrees >= 180 || straightLineThresholdDegrees > maximumAngleChangeDegrees ||
        !Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 10000) {
      return failure('INVALID_OPTIONS', 'Require 0 <= epsilonDeg <= maxAngleChangeDeg < 180 and 2..10000 samples.');
    }
    if (input.unit !== 'cm' && input.unit !== 'mm') {
      return failure('INVALID_UNIT', 'Declare unit as cm or mm.');
    }
    if (input.frameValid !== true || !isObject(input.sensorStatus)) {
      return failure('INVALID_SENSOR_FRAME', 'Require frameValid:true and four explicit OK sensor statuses.');
    }
    for (const sensorName of SENSOR_NAMES) {
      if (input.sensorStatus[sensorName] !== 'OK') {
        return failure('INVALID_SENSOR_FRAME', sensorName + ' is not OK.');
      }
    }
    if (input.synchronized !== true) {
      return failure('UNSYNCHRONIZED_FRAME', 'Synchronization must be explicitly confirmed by F01.');
    }

    // Nếu có thời điểm từng cảm biến, kiểm tra cả bằng chứng đồng bộ này.
    if (input.sensorTimestampsUs !== undefined || input.maxSkewUs !== undefined) {
      if (!isObject(input.sensorTimestampsUs) || !isFiniteNumber(input.maxSkewUs) || input.maxSkewUs < 0) {
        return failure('UNSYNCHRONIZED_FRAME', 'Require four sensor timestamps and maxSkewUs.');
      }
      const sensorTimestamps = [];
      for (const sensorName of SENSOR_NAMES) {
        const timestamp = input.sensorTimestampsUs[sensorName];
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
          return failure('UNSYNCHRONIZED_FRAME', 'Sensor timestamps must be nonnegative safe integers.');
        }
        sensorTimestamps.push(timestamp);
      }
      const timestampDifference = Math.max(...sensorTimestamps) - Math.min(...sensorTimestamps);
      if (timestampDifference > input.maxSkewUs) {
        return failure('UNSYNCHRONIZED_FRAME', 'Sensor timestamp skew exceeds the configured acquisition limit.');
      }
    }

    if (!isObject(input.pitchDeg)) {
      return failure('INVALID_PITCH', 'Require four pitches.');
    }
    for (const sensorName of SENSOR_NAMES) {
      const pitchDegrees = input.pitchDeg[sensorName];
      if (!isFiniteNumber(pitchDegrees) || pitchDegrees < -180 || pitchDegrees > 180) {
        return failure('INVALID_PITCH', 'Require four finite pitches in [-180,180] degrees.');
      }
    }
    if (!isObject(input.distances)) {
      return failure('INVALID_DISTANCE', 'Require d12, d23 and d34.');
    }
    for (const distanceName of ['d12', 'd23', 'd34']) {
      const arcLength = input.distances[distanceName];
      if (!isFiniteNumber(arcLength) || arcLength <= 0) {
        return failure('INVALID_DISTANCE', 'Require three finite, positive belt arc lengths.');
      }
    }
    return null;
  }

  /**
   * Tính sin(góc)/góc. Giới hạn khi góc tiến về 0 là 1.
   * Nhánh rất gần 0 dùng khai triển để giữ chính xác số thực.
   * Đây chỉ là chi tiết tính toán; không phải một mô hình hình học khác.
   */
  function calculateSineOverAngle(angleRadians) {
    if (Math.abs(angleRadians) < 0.0001) {
      const angleSquared = angleRadians * angleRadians;
      return 1 - angleSquared / 6 + angleSquared * angleSquared / 120;
    }
    return Math.sin(angleRadians) / angleRadians;
  }

  /** Dựng một đoạn từ cảm biến dưới lên cảm biến trên. */
  function buildSegment(startPoint, startPitchDegrees, angleChangeDegrees, arcLength, settings) {
    const startAngleRadians = startPitchDegrees * RADIANS_PER_DEGREE;
    const angleChangeRadians = angleChangeDegrees * RADIANS_PER_DEGREE;
    const isStraightLine = angleChangeDegrees === 0 || Math.abs(angleChangeDegrees) < settings.epsilonDeg;
    let curvature = 0;
    let radius = null;
    let center = null;
    let endAngleRadians = startAngleRadians;

    if (!isStraightLine) {
      // Độ cong có dấu = chênh góc (radian) / chiều dài cung.
      curvature = angleChangeRadians / arcLength;
      radius = arcLength / Math.abs(angleChangeRadians);
      endAngleRadians = startAngleRadians + angleChangeRadians;
      // Tâm nằm theo pháp tuyến (cos(theta), -sin(theta)) của hệ trục SPT.
      center = {
        x: startPoint.x + Math.cos(startAngleRadians) / curvature,
        y: startPoint.y - Math.sin(startAngleRadians) / curvature
      };
    }

    const sampledPoints = [startPoint];
    for (let sampleIndex = 1; sampleIndex < settings.samplesPerSegment; sampleIndex++) {
      const fractionAlongSegment = sampleIndex / (settings.samplesPerSegment - 1);
      const distanceFromStart = arcLength * fractionAlongSegment;
      let pointX;
      let pointY;
      if (isStraightLine) {
        // Đoạn thẳng: đi một quãng s theo hướng (sin(theta), cos(theta)).
        pointX = startPoint.x + distanceFromStart * Math.sin(startAngleRadians);
        pointY = startPoint.y + distanceFromStart * Math.cos(startAngleRadians);
      } else {
        // Công thức gốc:
        // x = xs + (cos(theta_s) - cos(theta_s + kappa*s)) / kappa
        // y = ys + (sin(theta_s + kappa*s) - sin(theta_s)) / kappa
        // Dạng nửa góc sau tương đương và tránh trừ hai số gần bằng nhau.
        const halfAngleChangeRadians = angleChangeRadians * fractionAlongSegment / 2;
        const middleAngleRadians = startAngleRadians + halfAngleChangeRadians;
        const chordLength = distanceFromStart * calculateSineOverAngle(halfAngleChangeRadians);
        pointX = startPoint.x + chordLength * Math.sin(middleAngleRadians);
        pointY = startPoint.y + chordLength * Math.cos(middleAngleRadians);
      }
      sampledPoints.push({ x: pointX, y: pointY });
    }

    return {
      type: isStraightLine ? 'line' : 'arc',
      length: arcLength,
      deltaDeg: angleChangeDegrees,
      curvature: curvature,
      radius: radius,
      center: center,
      start: startPoint,
      end: sampledPoints[sampledPoints.length - 1],
      thetaStartRad: startAngleRadians,
      thetaEndRad: endAngleRadians,
      polyline: sampledPoints
    };
  }

  function hasFiniteGeometry(segment) {
    if (!isFiniteNumber(segment.curvature) || !isFiniteNumber(segment.thetaStartRad) || !isFiniteNumber(segment.thetaEndRad)) {
      return false;
    }
    if (segment.type === 'arc') {
      if (!isFiniteNumber(segment.radius) || segment.radius <= 0 || segment.curvature === 0 ||
          !isFiniteNumber(segment.center.x) || !isFiniteNumber(segment.center.y)) {
        return false;
      }
    }
    for (const point of segment.polyline) {
      if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Nhận bốn Pitch và ba chiều dài cung, trả đường lưng 2D.
   * P4=(0,0); X dương hướng trước cơ thể; Y dương lên trên.
   * Không trừ góc P4, vì cần giữ góc nghiêng thật của cả đường lưng.
   * Xem docs/F02.1-giai-thich.md để đọc lời giải thích và ví dụ số.
   */
  function reconstructSpine2D(input, options = {}) {
    // Bước 1: kiểm tra cảm biến, đồng bộ, đơn vị, góc và chiều dài.
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const validationError = validateInput(input, options, settings);
    if (validationError !== null) {
      return validationError;
    }

    // Bước 2: tính góc tương đối: cảm biến trên trừ cảm biến dưới.
    const relativeAnglesDegrees = {
      q12: wrapDegrees(input.pitchDeg.P1 - input.pitchDeg.P2),
      q23: wrapDegrees(input.pitchDeg.P2 - input.pitchDeg.P3),
      q34: wrapDegrees(input.pitchDeg.P3 - input.pitchDeg.P4)
    };

    // Bước 3: khai báo rõ ba đoạn, từ dưới lên, với chiều dài riêng.
    const segmentDefinitions = [
      { from: 'P4', to: 'P3', length: input.distances.d34, angleChangeDegrees: relativeAnglesDegrees.q34 },
      { from: 'P3', to: 'P2', length: input.distances.d23, angleChangeDegrees: relativeAnglesDegrees.q23 },
      { from: 'P2', to: 'P1', length: input.distances.d12, angleChangeDegrees: relativeAnglesDegrees.q12 }
    ];
    for (const definition of segmentDefinitions) {
      if (Math.abs(definition.angleChangeDegrees) > settings.maxAngleChangeDeg) {
        return failure('UNSUPPORTED_ANGLE_CHANGE', 'Adjacent pitch difference exceeds maxAngleChangeDeg.');
      }
    }

    const sensorPoints = { P4: { x: 0, y: 0 } };
    const segments = [];
    const curvePoints = [sensorPoints.P4];
    let totalLength = 0;

    // Bước 4: dựng từng đoạn; điểm cuối đoạn trước chính là điểm đầu đoạn sau.
    for (const definition of segmentDefinitions) {
      const segment = buildSegment(
        sensorPoints[definition.from],
        input.pitchDeg[definition.from],
        definition.angleChangeDegrees,
        definition.length,
        settings
      );
      segment.from = definition.from;
      segment.to = definition.to;
      if (!hasFiniteGeometry(segment)) {
        return failure('NUMERICAL_OVERFLOW', 'Configuration exceeds finite numerical range.');
      }
      sensorPoints[definition.to] = segment.end;
      segments.push(segment);
      totalLength += segment.length;

      // Bước 5: không lặp điểm nối, vì nó đã có ở đoạn trước.
      for (let sampleIndex = 1; sampleIndex < segment.polyline.length; sampleIndex++) {
        curvePoints.push(segment.polyline[sampleIndex]);
      }
    }
    if (!isFiniteNumber(totalLength)) {
      return failure('NUMERICAL_OVERFLOW', 'Total arc length exceeds finite numerical range.');
    }

    // Bước 6: trả đơn vị vật lý. Giao diện tự đổi sang pixel và đảo Y khi vẽ SVG.
    return {
      valid: true,
      unit: input.unit,
      points: sensorPoints,
      relativeAnglesDeg: relativeAnglesDegrees,
      segments: segments,
      curvePoints: curvePoints,
      totalLength: totalLength,
      error: null
    };
  }

  return { reconstructSpine2D, wrapDegrees, DEFAULT_OPTIONS, failure };
});
