export function assertPackagedFluxCliContract(params: {
  runAsNodeFuseEnabled: boolean | undefined;
}): void {
  if (params.runAsNodeFuseEnabled !== true) {
    throw new Error(
      '[forge.config] packaged Fluxx CLI shims use FLUXX_ELECTRON_EXE/FLUX_ELECTRON_EXE with ELECTRON_RUN_AS_NODE=1, so the RunAsNode fuse must stay enabled',
    );
  }
}
