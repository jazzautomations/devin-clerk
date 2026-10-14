import { cache } from "react";
import { deploysEnabled } from "@/lib/deploys";
import { DeployPanelClient, type DeployPanelDeploy } from "@/components/DeployPanelClient";

// Com a publicação de demos desligada (HACKAHUB_DEPLOY_TOOL fora de "on" ou
// o toggle do admin), o card do time não mostra botão que só daria erro.
// cache(): uma consulta ao settings por request, não uma por card.
const enabled = cache(deploysEnabled);

export async function DeployPanel(props: {
  teamId: number;
  canDeploy: boolean;
  hasRepo: boolean;
  initialDeploy?: DeployPanelDeploy | null;
}) {
  if (!(await enabled())) return null;
  return <DeployPanelClient {...props} />;
}
