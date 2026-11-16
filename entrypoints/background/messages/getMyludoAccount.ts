import myludoRepository from "~/core/repositories/myludoRepository";
import type { MyludoAccount } from "~/core/registrationStatus/types";

export default async function getMyludoAccount(): Promise<MyludoAccount> {
    // chrome.permissions n'est pas disponible dans les scripts de contenu : la vérification se fait ici
    const hasPermission = await chrome.permissions
        .contains({ origins: ['https://www.myludo.fr/*'] })
        .catch(() => false);

    if (!hasPermission) return { status: "permissionMissing" };

    return myludoRepository.getAccount();
}
