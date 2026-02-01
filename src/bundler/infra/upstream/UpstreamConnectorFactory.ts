/**
 * Upstream Connector Factory
 *
 * Creates and configures upstream connectors with filtering and namespacing.
 * Lean implementation: no complex abstractions, just simple factory method.
 */

import { IUpstreamConnector } from "../../domain/upstream.js";
import { MCPConfig } from "../../core/schemas.js";
import { INamespaceService } from "../../app/core/namespace-resolver.js";
import { IPermissionService } from "../../app/core/permission-manager.js";

export interface IConnectorFactory {
  createConnector(
    config: MCPConfig,
    namespaceService: INamespaceService,
    permissionService: IPermissionService
  ): Promise<IUpstreamConnector>;
}

export class UpstreamConnectorFactory implements IConnectorFactory {
  async createConnector(
    config: MCPConfig,
    namespaceService: INamespaceService,
    permissionService: IPermissionService
  ): Promise<IUpstreamConnector> {
    const { HttpUpstreamConnector } = await import("../../app/upstream/upstream-connector.js");
    const { FilteredUpstreamConnector } = await import("../../app/upstream/filtered-upstream-connector.js");

    // Support just HTTP upstreams for now
    const baseConnector = new HttpUpstreamConnector();
    baseConnector.initialize(config);

    const filteredConnector = new FilteredUpstreamConnector(
      baseConnector,
      config,
      namespaceService,
      permissionService
    );

    return filteredConnector;
  }
}
