"use server";
import { getRepositoryContext, saveRepositoryContext } from "@/features/sources/context/repository-context";
export async function loadProductContext(owner: string, repo: string) { return getRepositoryContext({ owner, repo }); }
export async function storeProductContext(owner: string, repo: string, text: string) { return saveRepositoryContext({ owner, repo }, text); }
