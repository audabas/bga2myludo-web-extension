import myludoRepository from "~/core/repositories/myludoRepository";

export default async function getMyludoPlayDetails(playId: string) {
    return myludoRepository.getPlayDetails(playId);
}
