/**
 * Tools the add-ons in this app give the agent, as `SHARED_TOOLS`.
 *
 * Generated: rebuilt from the add-on tool modules under `src/tools/` on every
 * generation. A scenario's agent adds `SHARED_TOOLS` to its own tools, so an
 * add-on's tools reach the agent without the scenario importing them.
 */

import { TOOLS as WARM_TRANSFER_TOOLS } from './warmTransfer.js'

export const SHARED_TOOLS = [...WARM_TRANSFER_TOOLS]
