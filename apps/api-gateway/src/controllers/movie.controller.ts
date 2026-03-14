import { Request, Response } from "express";
import * as movieService from "../services/movie.service";
import type { ProgressUpdateDto } from "@shelby-movie/shared-types";

export async function home(req: Request, res: Response) {
  const walletAddress = req.query.walletAddress as string | undefined;
  const data = await movieService.getHomeData(walletAddress);
  res.json(data);
}

export async function index(req: Request, res: Response) {
  const movies = await movieService.listMovies();
  res.json(movies);
}

export async function show(req: Request, res: Response) {
  const movie = await movieService.getMovie(req.params.id);
  if (!movie) return res.status(404).json({ error: "Movie not found" });
  res.json(movie);
}

export async function create(req: Request, res: Response) {
  const movie = await movieService.createMovie(req.body);
  res.status(201).json(movie);
}

export async function progress(req: Request, res: Response) {
  const dto = req.body as ProgressUpdateDto;
  if (!dto.walletAddress || !dto.movieId || dto.lastPosition == null) {
    return res.status(400).json({ error: "walletAddress, movieId, lastPosition required" });
  }

  await movieService.upsertProgress(
    dto.walletAddress,
    dto.movieId,
    dto.episodeNumber ?? 1,
    dto.lastPosition
  );

  res.json({ ok: true });
}

export async function getProgress(req: Request, res: Response) {
  const { walletAddress, movieId, episodeNumber } = req.query;
  if (!walletAddress || !movieId) {
    return res.status(400).json({ error: "walletAddress and movieId required" });
  }

  const result = await movieService.getProgress(
    walletAddress as string,
    movieId as string,
    episodeNumber ? parseInt(episodeNumber as string, 10) : 1
  );

  res.json(result ?? { lastPosition: 0 });
}
