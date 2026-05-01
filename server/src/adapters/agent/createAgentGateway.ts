import { AgentGateway } from '../../application/ports/agentGateway';
import { AppConfig } from '../../config';
import { createDeterministicAgentGateway } from './deterministicAgentGateway';
import { createOpenAiAgentGateway } from './openAiAgentGateway';

export function createAgentGateway(config: AppConfig): AgentGateway {
  if (config.openaiApiKey) {
    return createOpenAiAgentGateway(config);
  }

  return createDeterministicAgentGateway();
}
