# Architecture

## Components

- **ESP32 firmware:** Reads posture-related sensors and controls the device hardware.
- **Backend:** Will contain posture processing, 2D spine curve modeling, monitoring,
  integrations, orchestration, and persistence.
- **Node-RED:** Intended for later backend workflow orchestration.
- **Frontend:** Will provide the dashboard and user interface.
- **Persistence:** The storage technology and data model are TBD.

## Data flow

The ESP32 is expected to collect sensor measurements and communicate with the
backend. The backend will process measurements, store appropriate data, and make
results available to the frontend. The exact transport, message format, and
workflow are TBD.

## Open decisions

- Backend runtime and application structure: TBD.
- Sensor and actuator details: TBD.
- Persistence technology and retention policy: TBD.
- Deployment and hosting approach: TBD.
