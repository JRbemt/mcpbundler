/**
 * Upstream Connector Factory
 *
 * Creates and configures upstream connectors with filtering and namespacing.
 * Lean implementation: no complex abstractions, just simple factory method.
 */

import { IUpstreamConnector } from "./upstream.js";
import { MCPConfig } from "../schemas.js";
import { INamespaceService } from "../session/namespace-resolver.js";
import { IPermissionService } from "../session/permission-manager.js";

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
    const { HttpUpstreamConnector } = await import("../upstream/upstream-connector.js");
    const { FilteredUpstreamConnector } = await import("../upstream/filtered-upstream-connector.js");

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
