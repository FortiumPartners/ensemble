/**
 * AgentTranslator - TypeScript type definitions
 *
 * The canonical implementation is in agent-translator.js (CommonJS).
 * This file provides TypeScript type declarations only.
 *
 * Task IDs: OC-S2-AGT-001 through OC-S2-AGT-011
 */

export interface AgentTranslatorOptions {
  packagesDir: string;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
}

export interface TranslatedAgent {
  markdownPath: string;
  markdownContent: string;
  configEntry: Record<string, unknown>;
  sourcePath: string;
}

export interface AgentTranslatorResult {
  agents: TranslatedAgent[];
  configBlock: Record<string, unknown>;
  routingPrompt: string;
  errors: Array<{ filePath: string; message: string; error: Error }>;
}

export declare class AgentTranslator {
  constructor(options: AgentTranslatorOptions);
  packagesDir: string;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
  parseAgentYaml(filePath: string): Record<string, unknown>;
  discoverAgentFiles(): string[];
  mapToolPermissions(tools: string[]): Record<string, string>;
  generatePrompt(agent: Record<string, unknown>): string;
  classifyMode(category: string | undefined): 'primary' | 'subagent';
  mapModelHint(hint: string | undefined | null): { providerID: string; modelID: string };
  generateConfigEntry(agent: Record<string, unknown>): Record<string, unknown>;
  generateMarkdown(agent: Record<string, unknown>): string;
  getOutputPath(agent: Record<string, unknown>): string;
  extractDelegationHierarchy(agent: Record<string, unknown>): {
    delegatesTo: string[];
    receivesFrom: string[];
    handsOffTo: string[];
  };
  generateRoutingPrompt(agents: Array<Record<string, unknown>>): string;
  classifyCategory(category: string | undefined): string;
  executeSync(): AgentTranslatorResult;
}
