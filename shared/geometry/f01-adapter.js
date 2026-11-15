(function (globalObject, createAdapterModule) {
  if (typeof module === 'object' && module.exports) {
    module.exports = createAdapterModule(require('./spine2d'));
  } else {
    globalObject.SpineF01 = createAdapterModule(globalObject.Spine2D);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (geometry) {
  'use strict';

  const SENSOR_NAMES = ['P1', 'P2', 'P3', 'P4'];

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function hasFourValues(value) {
    return Array.isArray(value) && value.length === 4;
  }

  // Đổi [góc P1, góc P2, góc P3, góc P4] thành {P1:..., P2:..., P3:..., P4:...}.
  function mapValuesToSensorNames(values) {
    const valuesBySensor = {};
    for (let sensorIndex = 0; sensorIndex < SENSOR_NAMES.length; sensorIndex++) {
      valuesBySensor[SENSOR_NAMES[sensorIndex]] = values[sensorIndex];
    }
    return valuesBySensor;
  }

  /**
   * Chuyển dữ liệu F01 hoặc MQTT v2 sang input của core hình học.
   * Context do nơi thu nhận dữ liệu xác nhận cho đúng frame hiện tại.
   * Không tự suy ra đồng bộ từ một timestamp tổng hoặc cờ curve_valid.
   * Xác thực thiết bị, phiên, boot và độ mới do nơi nhận telemetry phụ trách.
   */
  function reconstructF01Frame(frame, config, context, options) {
    if (!isObject(frame) || !isObject(config) || !isObject(context) || context.pitchConvention !== 'SPT') {
      return geometry.failure('INVALID_SENSOR_FRAME', 'Require frame, geometry config and confirmed SPT pitch convention.');
    }

    const usesProtocolVersion2 = frame.schema_version === 2;
    if (frame.schema_version !== undefined && !usesProtocolVersion2) {
      return geometry.failure('INVALID_SENSOR_FRAME', 'Unsupported schema version.');
    }

    let pitchDegrees = frame.pitch;
    let sensorStatuses = frame.status;
    let frameTimestampMicroseconds = frame.timestamp;
    if (usesProtocolVersion2) {
      pitchDegrees = frame.pitch_deg;
      sensorStatuses = frame.sensor_quality;
      frameTimestampMicroseconds = frame.t_mono_us;
    }
    if (!hasFourValues(pitchDegrees) || !hasFourValues(sensorStatuses) ||
        !Number.isSafeInteger(frameTimestampMicroseconds) || frameTimestampMicroseconds < 0) {
      return geometry.failure('INVALID_SENSOR_FRAME', 'Require four pitches/statuses and the acquisition timestamp.');
    }

    if (usesProtocolVersion2) {
      if (typeof frame.geometry_rev !== 'string' || !frame.geometry_rev || frame.geometry_rev !== config.geometry_rev) {
        return geometry.failure('INVALID_CONFIG', 'Telemetry geometry_rev must match the immutable config snapshot.');
      }
      if (frame.curve_valid !== true) {
        return geometry.failure('INVALID_SENSOR_FRAME', 'Telemetry explicitly rejects the curve.');
      }
      if (!Array.isArray(config.distances_mm) || config.distances_mm.length !== 3) {
        return geometry.failure('INVALID_DISTANCE', 'Require distances_mm in d12,d23,d34 order.');
      }
    }

    const sensorTimestampsMicroseconds = context.sensorTimestampsUs;
    if (sensorTimestampsMicroseconds !== undefined && !hasFourValues(sensorTimestampsMicroseconds)) {
      return geometry.failure('UNSYNCHRONIZED_FRAME', 'Require four sensor timestamps.');
    }

    // F01 dùng 1/0, còn v2 dùng OK/MISSING/STALE/...; chỉ trạng thái hợp lệ mới thành OK.
    const statusesBySensor = {};
    for (let sensorIndex = 0; sensorIndex < SENSOR_NAMES.length; sensorIndex++) {
      let sensorIsValid;
      if (usesProtocolVersion2) {
        sensorIsValid = sensorStatuses[sensorIndex] === 'OK';
      } else {
        sensorIsValid = sensorStatuses[sensorIndex] === 1;
      }
      statusesBySensor[SENSOR_NAMES[sensorIndex]] = sensorIsValid ? 'OK' : 'INVALID';
    }

    const input = {
      pitchDeg: mapValuesToSensorNames(pitchDegrees),
      sensorStatus: statusesBySensor,
      distances: config.distances,
      unit: config.unit,
      frameValid: context.frameValid,
      synchronized: context.synchronized,
      maxSkewUs: context.maxSkewUs
    };
    if (usesProtocolVersion2) {
      input.distances = {
        d12: config.distances_mm[0],
        d23: config.distances_mm[1],
        d34: config.distances_mm[2]
      };
      input.unit = 'mm';
    }
    if (sensorTimestampsMicroseconds !== undefined) {
      input.sensorTimestampsUs = mapValuesToSensorNames(sensorTimestampsMicroseconds);
    }

    // Core tính lại góc trên trừ góc dưới. Không dùng relative[] legacy ngược dấu.
    return geometry.reconstructSpine2D(input, options);
  }

  /** Đổi kết quả sang contract MQTT hiện có: tọa độ mm và độ cong 1/mm. */
  function toTelemetryCurve(result) {
    if (!result || result.valid !== true) return null;

    const millimetersPerInputUnit = result.unit === 'cm' ? 10 : 1;
    const nodesMillimeters = [];
    const curvaturesPerMillimeter = [];
    for (const sensorName of ['P4', 'P3', 'P2', 'P1']) {
      const point = result.points[sensorName];
      const positionXMillimeters = point.x * millimetersPerInputUnit;
      const positionYMillimeters = point.y * millimetersPerInputUnit;
      if (!Number.isFinite(positionXMillimeters) || !Number.isFinite(positionYMillimeters)) return null;
      nodesMillimeters.push([positionXMillimeters, positionYMillimeters]);
    }
    for (const segment of result.segments) {
      const curvaturePerMillimeter = segment.curvature / millimetersPerInputUnit;
      if (!Number.isFinite(curvaturePerMillimeter)) return null;
      curvaturesPerMillimeter.push(curvaturePerMillimeter);
    }
    return {
      order: ['P4', 'P3', 'P2', 'P1'],
      nodes_mm: nodesMillimeters,
      kappa_per_mm: curvaturesPerMillimeter
    };
  }

  return { reconstructF01Frame, toTelemetryCurve };
});
