import boardGameArenaRepository from "~/core/repositories/boardGameArenaRepository";

export default async function getBgaGames(query: string) {
    return boardGameArenaRepository.getGames(query);
}
