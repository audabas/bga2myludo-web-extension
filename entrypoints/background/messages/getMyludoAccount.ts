import myludoRepository from "~/core/repositories/myludoRepository";
import type { MyludoAccount } from "~/core/registrationStatus/types";
import myludoService from "~/core/services/myludoService";

export default async function getMyludoAccount(): Promise<MyludoAccount> {
    // chrome.permissions n'est pas disponible dans les scripts de contenu : la vérification se fait ici, dans le script de fond
    if (!(await myludoService.hasPermission())) return { status: "permissionMissing" };

    return myludoRepository.getAccount();
}
