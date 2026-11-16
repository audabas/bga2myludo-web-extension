import boardGameArenaRepository from "~/core/repositories/boardGameArenaRepository";

export default async function getBgaBoard(query: string) {
    return boardGameArenaRepository.getBoard(query);
}
