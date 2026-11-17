import myludoRepository from "~/core/repositories/myludoRepository";

export default async function getMyludoPlayedGames() {
    return myludoRepository.getPlayedGames();
}
