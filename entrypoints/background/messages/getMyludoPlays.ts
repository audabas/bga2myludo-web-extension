import myludoRepository from "~/core/repositories/myludoRepository";

export default async function getMyludoPlays(myludoGameId: string, dateFrom: string, dateTo: string) {
    return myludoRepository.getPlays(myludoGameId, dateFrom, dateTo);
}
