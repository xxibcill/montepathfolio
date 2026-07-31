import { runSimulation } from "../lib/simulation";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "../types/simulation";

self.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const requestId = event.data?.id ?? -1;

  try {
    if (!event.data || !Number.isInteger(event.data.id)) {
      throw new Error("Simulation worker request must include an integer id");
    }

    const response: SimulationWorkerResponse = {
      id: requestId,
      result: runSimulation(event.data.inputs),
    };
    self.postMessage(response);
  } catch (error) {
    const response: SimulationWorkerResponse = {
      id: requestId,
      error: error instanceof Error ? error.message : "Simulation failed",
    };
    self.postMessage(response);
  }
};
