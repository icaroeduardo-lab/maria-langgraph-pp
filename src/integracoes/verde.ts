import type { DadosApenado, DadosProcesso } from "../shared/types.js";

// TODO: VERDE_JWT_TOKEN é temporário (emitido como app "Tykhe" pelo Verde,
// expira 2026-09-12) — precisa de credencial própria da Maria antes disso.
const VERDE_API_URL = process.env.VERDE_API_URL ?? "https://homologacao.verde.rj.def.br/api/integra";
const VERDE_JWT_TOKEN = process.env.VERDE_JWT_TOKEN ?? "";
const VERDE_CLIENT_ID = process.env.VERDE_CLIENT_ID ?? "";

interface ApenadoResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: {
    idSeap?: number;
    nome?: string;
    situacao?: string;
    idPessoa?: number;
  };
}

export async function consultarApenadoPorRg(rg: string): Promise<DadosApenado> {
  if (!VERDE_JWT_TOKEN) {
    console.warn("[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    // RG "000000000" simula "não encontrado" no mock (pra testar o fluxo de
    // retry sem depender do Verde real) — qualquer outro RG "acha" a pessoa
    // de teste.
    if (rg === "000000000") return { encontrado: false };
    return { encontrado: true, idSeap: 999999, idPessoa: 999999, nome: "Pessoa de Teste (mock)", situacao: "ATIVO" };
  }
  try {
    const res = await fetch(`${VERDE_API_URL}/apenado`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      body: JSON.stringify({ rg }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[verde] apenado: HTTP ${res.status}`);
      return { encontrado: false };
    }
    const corpo = (await res.json()) as ApenadoResponseVerde;
    // RG não encontrado: Verde devolve "dados": {} (objeto VAZIO, não null/
    // ausente — confirmado ao vivo 2026-08-28) — checar só `!corpo.dados`
    // não pega isso, `{}` é truthy. Checa um campo que só existe se achou
    // de verdade.
    if (!corpo.dados || corpo.dados.idPessoa === undefined) return { encontrado: false };
    return {
      encontrado: true,
      idSeap: corpo.dados.idSeap,
      idPessoa: corpo.dados.idPessoa,
      nome: corpo.dados.nome,
      situacao: corpo.dados.situacao,
    };
  } catch (err) {
    console.error("[verde] apenado: falha na chamada:", err);
    return { encontrado: false };
  }
}

interface ProcessoResponseVerde {
  codigo?: string;
  mensagem?: string;
  dados?: {
    id?: number;
    origem?: string;
    instancia?: number;
    nomeAssunto?: string;
    nomeOrgaoJulgador?: string;
    movimentos?: Array<{ titulo?: string; data?: string; descricao?: string; traducao?: string }>;
  };
}

// Consulta o processo pelo número informado (só chamada quando temProcesso:
// true — ver fluxos/pessoaPresa/graph.ts). Diferente de consultarApenadoPorRg,
// NÃO trava o fluxo: erro/não encontrado só fica registrado em
// dadosProcesso.encontrado, sem retry nem pergunta de "tentar de novo" — é
// informação complementar pra Tykhe, não um gate de identificação.
export async function consultarProcesso(numero: string): Promise<DadosProcesso> {
  if (!VERDE_JWT_TOKEN) {
    console.warn("[verde] VERDE_JWT_TOKEN ausente — modo mock (dev local)");
    return { encontrado: true, id: 999999, origem: "e-Proc (mock)", nomeAssunto: "Processo de Teste" };
  }
  try {
    const res = await fetch(`${VERDE_API_URL}/processo/consultar/${encodeURIComponent(numero)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${VERDE_JWT_TOKEN}`,
        "x-client-id": VERDE_CLIENT_ID,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[verde] processo: HTTP ${res.status}`);
      return { encontrado: false };
    }
    const corpo = (await res.json()) as ProcessoResponseVerde;
    if (!corpo.dados || corpo.dados.id === undefined) return { encontrado: false };
    return {
      encontrado: true,
      id: corpo.dados.id,
      origem: corpo.dados.origem,
      instancia: corpo.dados.instancia,
      nomeAssunto: corpo.dados.nomeAssunto,
      nomeOrgaoJulgador: corpo.dados.nomeOrgaoJulgador,
      movimentos: corpo.dados.movimentos,
    };
  } catch (err) {
    console.error("[verde] processo: falha na chamada:", err);
    return { encontrado: false };
  }
}
