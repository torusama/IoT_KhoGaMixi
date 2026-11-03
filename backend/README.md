# Smart Posture Tracker Backend

The backend is intended to be the application layer of the Smart Posture
Tracker (SPT). It will eventually process posture-related data from the ESP32,
run posture and 2D spine-curve calculations, coordinate integrations, and
provide results to other system components.

The current backend is a project scaffold, not a runnable application. The
ESP32 firmware is responsible for hardware access and sensor acquisition, and
the frontend is intended to provide the user interface. No backend runtime,
API, sensor-data input, spine model, or persistence implementation currently
exists.

## Directory structure

| Path | Responsibility | Status |
| --- | --- | --- |
| `config/config.example.json` | Example shape for environment, MQTT, persistence, and notification settings. Values are empty placeholders. | Configuration template |
| `logic/` | Reserved for posture monitoring and 2D spine-curve modeling. | Planned |
| `integrations/mqtt/` | Reserved for the backend MQTT integration. | Planned |
| `integrations/firebase/` | Reserved for Firebase integration and persistence. | Planned |
| `integrations/email/` | Reserved for email notifications. | Planned |
| `node-red/` | Reserved for Node-RED orchestration flows. | Planned |

The README files in the reserved directories document their intended scope;
they do not define implemented functions, classes, or APIs.

## File responsibilities

### `config/config.example.json`

This JSON file is a configuration example, not an active runtime configuration.
It currently contains:

- `environment`: intended runtime environment name (`development` in the
  example).
- `mqtt.brokerUrl`: placeholder for an MQTT broker URL.
- `mqtt.clientId`: placeholder for an MQTT client identifier.
- `persistence.provider`: placeholder for the chosen storage provider.
- `notifications.emailEnabled`: example flag for email notifications.

No code currently loads or validates this file. It contains no credentials.

### `logic/`

`logic/README.md` reserves this directory for posture monitoring and 2D spine
curve modeling. There are currently no source files, functions, classes, input
schemas, or output schemas.

In particular, no `spine_model` module exists yet. The repository therefore
does not verify:

- whether the model will receive raw MPU6050 readings or processed data;
- which calculations or paper formulas it will implement;
- what posture or spine representation it will output; or
- how calibration, filtering, or model parameters will be configured.

The reference architecture mentions a 2D spine curve model, but no
implementation currently supports a claim that the reference-paper formulas
are being applied.

### Integration and orchestration directories

The following directories contain only scope documentation at present:

- `integrations/mqtt/README.md`: says the MQTT communication contract is
  pending.
- `integrations/firebase/README.md`: reserves the directory for future
  Firebase integration and persistence.
- `integrations/email/README.md`: reserves the directory for future email
  notifications.
- `node-red/README.md`: reserves the directory for future Node-RED flows.

They currently define no functions, classes, dependencies, transport handlers,
database connections, or data formats.

## Current data flow

No backend data flow is implemented. The intended system-level direction in
`docs/architecture.md` is:

`ESP32 sensor measurements -> backend processing -> persistence/results -> frontend`

The exact transport, message format, processing workflow, and persistence
technology are all TBD. A spine-model or posture-interpretation step cannot be
shown as active because no corresponding backend code exists.

The planned, not implemented, backend flow is:

`Sensor/Firmware Data -> Input Processing -> Spine Model -> Posture Interpretation -> Output`

The firmware currently has only initialization code and does not provide a
verified backend interface. The backend also has no confirmed HTTP API,
WebSocket, MQTT topic, serial protocol, Node-RED flow, database connection, or
frontend API.

## Interfaces and communication

No interfaces are implemented in this directory.

| Interface | Current status |
| --- | --- |
| ESP32 to backend | Planned; transport and payload format are TBD |
| MQTT | Planned; topics, payloads, QoS, retained messages, and acknowledgments are not finalized |
| HTTP or WebSocket API | Not present |
| Serial communication | Not present |
| Node-RED | Planned; no flows exist |
| Firebase or other database | Planned; provider and data model are TBD |
| Email notifications | Planned; no notification implementation exists |

The MQTT placeholder configuration does not establish an active MQTT
interface. See [`docs/mqtt-contract.md`](../docs/mqtt-contract.md) for the
unfinalized contract topics.

## Configuration and dependencies

The only backend configuration artifact is
[`config/config.example.json`](config/config.example.json). It documents
placeholder settings for MQTT, persistence, and email notifications. No
environment-variable names, dependency manifest, lockfile, package manager, or
external library requirement is defined for the backend.

Do not add real credentials to the example file. The repository setup
documentation states that local configuration and deployment settings are TBD.

## Running and testing

There is currently no backend command to install, start, build, or test. No
backend source code, test files, or test runner configuration exists.

The backend runtime and application structure remain TBD, so a runnable setup
cannot be documented without inventing behavior or commands.

## Limitations and TODOs

- Choose the backend runtime and application structure.
- Define the ESP32-to-backend transport and sensor-data payload.
- Implement input validation and processing.
- Define and implement the `spine_model`, including its inputs, outputs, and
  supported reference-paper calculations.
- Implement posture interpretation and monitoring logic.
- Choose and implement persistence, including its data model and retention
  policy.
- Define and implement MQTT topics and message behavior, if MQTT remains the
  selected transport.
- Implement Firebase integration if it is selected.
- Create Node-RED flows if orchestration is required.
- Implement email notifications if they are required.
- Define the frontend-facing API or other output interface.
- Add dependency management, runtime configuration loading, and automated
  tests.
