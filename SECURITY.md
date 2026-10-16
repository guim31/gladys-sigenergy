# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration stores and sends:

- `/data/sigenergy-layouts.json` holds what the probe found: the model,
  serial number and firmware of each inverter, its phases and PV strings, the
  rated powers and which registers the firmware implements. No secret: the
  configuration has none (Modbus TCP has no authentication).
- It opens one Modbus TCP connection to the address of the configuration
  (port 502 by default) and nowhere else; it reads the plant and inverter
  registers, and writes only the four battery control registers (40029,
  40031, 40032, 40034), only when battery control is allowed in the
  configuration.
- The logs never hold a password or an address with credentials; the serial
  numbers are masked in the output of the "Test the connection" button and
  of `scripts/probe.mjs`.

Modbus TCP itself is unauthenticated: anyone on the local network who can
reach port 502 of the system can read and write it, with or without this
integration. Keep the system on a trusted network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Sigenergy system, its firmware and the mySigen app.
