// Hackathon-only session routing. Production authentication is intentionally deferred.
// Names, specialties, lifecycle state, organization, and clinical data are loaded from FastAPI.
export const demoSession = {
  mode: 'synthetic-demo',
  currentPhysician: {
    npi: '9000000999',
    agentId: 'agent-9000000999',
  },
  specialistReviewer: {
    npi: '9000001000',
    agentId: 'agent-9000001000',
  },
} as const
