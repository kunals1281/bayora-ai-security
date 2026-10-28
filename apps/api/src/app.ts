import Fastify from "fastify";
import cors from "@fastify/cors";
import { errorHandler } from "./middleware/error-handler";
import {
  healthRoutes,
} from "./routes/health";
import {
  agentController,
  scenarioController,
  testRunController,
  failureController,
  reliabilityController,
  regressionController,
  traceController,
  copilotController,
  gatewayController,
} from "./controllers";

export function createApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.setErrorHandler(errorHandler);

  app.register(healthRoutes);

  app.register(agentController);
  app.register(scenarioController);
  app.register(testRunController);
  app.register(failureController);
  app.register(reliabilityController);
  app.register(regressionController);
  app.register(traceController);
  app.register(copilotController);
  app.register(gatewayController);

  return app;
}