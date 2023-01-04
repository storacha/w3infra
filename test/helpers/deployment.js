import {
  State
} from "@serverless-stack/core"

// Either seed.run deployment, or development deploy outputs-file
// https://seed.run/docs/adding-a-post-deploy-phase.html#post-deploy-phase-environment
export const stage = process.env.SEED_STAGE_NAME || State.getStage(process.cwd())
