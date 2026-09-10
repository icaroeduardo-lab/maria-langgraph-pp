// Fluxos que a Maria já sabe RECONHECER pelo relato (entram na
// classificação do orquestrador, ver rotas/orquestrador.ts), mas que ainda
// NÃO têm código implementado (fluxos/<nome>/graph.ts, registro em
// fluxosPorId). Quando a IA escolhe um destes, o orquestrador não tem grafo
// pra rodar — cai em handoff_humano, mas loga qual fluxo foi identificado.
//
// Serve pra medir demanda real ANTES de codar: dá pra consultar os logs
// (motivo "fluxo_nao_implementado") e saber qual fluxo pedir prioridade de
// implementação, sem precisar já ter o código pronto de todos os fluxos
// planejados pra começar a aprender com o uso real.
//
// Pra "ativar" um fluxo planejado: implementa fluxos/<nome>/{graph,state,api}.ts
// normal, registra em fluxosPorId (fluxos/index.ts) — e REMOVE a entrada
// correspondente daqui (senão fica duplicado nos dois catálogos).
export interface FluxoPlanejado {
  id: string;
  nome: string;
  descricao: string;
  // idCategoriaAssunto do Verde (GET /integra/assunto/categorias) que essa
  // entrada representa — ver issue #19. Guardado pra achar de volta na API
  // do Verde depois, sem precisar re-consultar a lista inteira; não é usado
  // pela classificação (ia/classificarFluxo.ts), só por nome/descricao.
  idCategoriaAssuntoVerde: number;
}

// Carregado a partir de GET /integra/assunto/categorias (Verde), confirmado
// ao vivo 2026-09-10 — 73 categorias no total, menos 2: a categoria
// "***PO$MA%R***" (idCategoriaAssunto 10129, lixo/teste do Verde) e
// "VIOLÊNCIA DOMÉSTICA" (10113, já implementada em fluxosPorId — ver
// idCategoriaAssuntoVerde ali, evita duplicar o mesmo fluxo nos 2 catálogos).
// Categorias sem descrição própria no Verde receberam uma descrição curta
// escrita à mão a partir do nome (não são texto oficial do Verde).
//
// RECLAMAÇÃO TRABALHISTA e LOAS têm descrição de redirecionamento
// permanente ("não atuamos, procure X") — issue #22 vai dar mensagem
// própria pra elas em vez da genérica de "em construção" (issue #21).
// FAQ pode não ser um fluxo de verdade — issue #23 decide isso.
export const fluxosPlanejados: FluxoPlanejado[] = [
  { id: "007e01e8-6c66-4c7a-9ce2-5be75e5a883c", nome: "abrigo", descricao: "atendimento para conseguir abrigo para pessoas em situação de risco", idCategoriaAssuntoVerde: 10053 },
  { id: "40dcee20-425f-4e96-98fe-72c4e21a9fcf", nome: "abrir/reconhecer firma", descricao: "Orientação sobre gratuidade para abrir ou reconhecer firma em cartório", idCategoriaAssuntoVerde: 10086 },
  { id: "c3ef627f-f4e5-4172-9887-a844e2dcec27", nome: "acidente de trabalho", descricao: "atendimento relacionado à acidente de trabalho", idCategoriaAssuntoVerde: 10050 },
  { id: "f995820a-8db3-46a1-b927-80bc746bb3bf", nome: "acidente de trânsito", descricao: "atendimento relacionado à acidente de trânsito", idCategoriaAssuntoVerde: 10052 },
  { id: "4128bcaa-b87c-4921-80ed-f4d9e9ec63df", nome: "acordo penal (anpp)", descricao: "Orientação e defesa em acordo de não persecução penal (anpp)", idCategoriaAssuntoVerde: 10116 },
  { id: "ad2e1abf-2f97-4792-acc9-837be5ee0cc1", nome: "adoção", descricao: "orientações sobre adoção", idCategoriaAssuntoVerde: 10044 },
  { id: "6e62a537-8da2-48a5-8d61-e9ed9082e65a", nome: "aluguel social", descricao: "Orientações sobre o benefício aluguel social", idCategoriaAssuntoVerde: 10056 },
  { id: "2ce11bc8-2cfa-4690-8aa3-272f76e48877", nome: "aposentadoria", descricao: "Orientações sobre aposentadoria", idCategoriaAssuntoVerde: 10047 },
  { id: "f3ba839c-85ac-4c0d-bec5-bfbced453dbc", nome: "apostilar documentos", descricao: "Autenticar documentos brasileiros para serem aceitos no exterior", idCategoriaAssuntoVerde: 10101 },
  { id: "b2aea666-4c40-46bb-a998-4a9e89716ebb", nome: "atendimento ao servidor público estadual civil", descricao: "Atendimento para servidores públicos estaduais que respondem por processos judiciais em razão do exercício da sua função.", idCategoriaAssuntoVerde: 10106 },
  { id: "c312a394-aa2b-45cc-8067-bf7a18753728", nome: "autorização para viagem", descricao: "Orientações para viagem de crianças e adolescentes", idCategoriaAssuntoVerde: 10082 },
  { id: "ea9c1a50-3346-4b42-aa87-a7024fdd3267", nome: "auxílio reclusão", descricao: "Orientações sobre o benefício auxílio reclusão", idCategoriaAssuntoVerde: 10058 },
  { id: "c22a3c73-6e57-4d69-a9c4-2b6c341aaa49", nome: "auxílios e benefícios", descricao: "Atendimento para auxílios e benefícios negados ou com valores incorretos", idCategoriaAssuntoVerde: 10118 },
  { id: "adc3a192-cde1-4034-b3c1-867eac80819b", nome: "ação contra 123 milhas", descricao: "Direito do consumidor: cancelamento e reembolsos da 123 milhas", idCategoriaAssuntoVerde: 10123 },
  { id: "501620ac-9427-4413-ab9f-81b7fd71ac28", nome: "ação rescisória/revisão", descricao: "Revisão de processo encerrado (ação rescisória e revisão criminal)", idCategoriaAssuntoVerde: 10108 },
  { id: "9985afbb-e784-41cc-838e-ab402091562c", nome: "bancos e financeiras", descricao: "Bancos, financeiras, seguradora: cobranças, dívidas, juros, indenização", idCategoriaAssuntoVerde: 10059 },
  { id: "7977ffb8-1b6e-46e5-9865-a32a39f63f12", nome: "busca cartorária rgi", descricao: "Orientação sobre como localizar o cartório onde um imóvel foi registrado", idCategoriaAssuntoVerde: 10089 },
  { id: "6842b257-ee0b-48e8-8b1f-d13092a6045f", nome: "busca e apreensão", descricao: "Atendimento para busca e apreensão de coisas e pessoas", idCategoriaAssuntoVerde: 10020 },
  { id: "f826ff64-6aa8-4750-b0a5-ca8d09bde9e9", nome: "cartão merenda", descricao: "Garantia do benefício de alimentação escolar da rede municipal do rio", idCategoriaAssuntoVerde: 10120 },
  { id: "e4e13ef2-6b38-4696-9e0a-51561b254a12", nome: "casamento e divórcio", descricao: "Orientações sobre casamento, divórcio e união estável", idCategoriaAssuntoVerde: 10021 },
  { id: "94678cf8-f791-422e-a53c-81344f3cab17", nome: "certidões de nada consta", descricao: "Gratuidade para certidões: nada consta, interdição, tutela e fiscais", idCategoriaAssuntoVerde: 10087 },
  { id: "24d83bd8-325c-4eb9-be9d-68d554c22831", nome: "citação/intimação", descricao: "Orientações sobre o recebimento de citações e intimações", idCategoriaAssuntoVerde: 10062 },
  { id: "7e3bbc4b-2371-4155-9e4b-82ea05ed0293", nome: "cobrança", descricao: "Atendimento para cobrança de dívidas ou entrega de coisas", idCategoriaAssuntoVerde: 10060 },
  { id: "e7423346-12b5-4c02-aedf-1d3ad04df2eb", nome: "comprovar estado civil", descricao: "Documento que confirma se a pessoa é solteira, casada ou divorciada", idCategoriaAssuntoVerde: 10066 },
  { id: "ea760719-4a1d-47a2-9a63-f40f01b4d890", nome: "concessionárias", descricao: "Atendimento sobre problemas com concessionárias de serviços públicos (água, luz, gás).", idCategoriaAssuntoVerde: 10054 },
  { id: "3e94e53d-15cb-43f5-9467-11f0bde4d40e", nome: "concurso público", descricao: "Orientações sobre concursos públicos", idCategoriaAssuntoVerde: 10043 },
  { id: "ce4e7a5b-ed73-4343-a3d1-e0da340ae447", nome: "conselhos profissionais", descricao: "Orientações para questões relacionadas aos conselhos profissionais", idCategoriaAssuntoVerde: 10064 },
  { id: "883fae14-8892-45d8-8144-f203362ae990", nome: "consignação em pagamento", descricao: "Dificuldade para pagar: não sabe a quem pagar ou credor não quer receber", idCategoriaAssuntoVerde: 10065 },
  { id: "7371aee7-e6af-4bf2-96d9-6d1202c8656f", nome: "declaração de ausência", descricao: "Ação de declaração de ausência para pessoas desaparecidas", idCategoriaAssuntoVerde: 10114 },
  { id: "387d436b-530b-41ab-8dea-46c982f40b65", nome: "defesa da criança", descricao: "Atendimento para defesa de crianças ou adolescentes", idCategoriaAssuntoVerde: 10112 },
  { id: "3792f3ba-4fbd-4334-9fd5-6a6dde351d83", nome: "detran", descricao: "Atendimento sobre questões relacionadas ao DETRAN — carteira de motorista, veículos, multas.", idCategoriaAssuntoVerde: 10040 },
  { id: "34a3d5c5-c9c4-4d83-825e-9ca35f5d1fb8", nome: "direito de vizinhança", descricao: "Atendimento sobre conflitos entre vizinhos — barulho, divisas, uso do imóvel.", idCategoriaAssuntoVerde: 10024 },
  { id: "a4d888a1-d4e4-4591-a0b6-ddc4ed229433", nome: "direitos autorais", descricao: "Defesa de direitos autorais e obras intelectuais (música, arte, livros)", idCategoriaAssuntoVerde: 10094 },
  { id: "e8841770-0398-4e1f-a2bc-eb3f68f8d242", nome: "direitos e diversidade", descricao: "Direitos e defesa para questões de diversidade de gênero e raça", idCategoriaAssuntoVerde: 10105 },
  { id: "82ebf85d-e152-4d95-89f6-9e150f42290f", nome: "doação de bens", descricao: "Transferir propriedade de bens (carro, imóvel, etc) para outra pessoa", idCategoriaAssuntoVerde: 10088 },
  { id: "521a7357-b369-4d7e-bf29-e87a7f746486", nome: "doação de órgãos", descricao: "Atendimento para conseguir autorização para doação de órgãos e tecidos", idCategoriaAssuntoVerde: 10117 },
  { id: "180001d2-5e0c-4f27-aa13-f425149a1336", nome: "educação, creche, escola", descricao: "Atendimento para vaga, matrícula, cobranças ou problemas com educação", idCategoriaAssuntoVerde: 10019 },
  { id: "212bfd3a-6223-421e-9ef5-e60a2294316a", nome: "emancipação", descricao: "Orientações sobre emancipação de menores de idade.", idCategoriaAssuntoVerde: 10067 },
  { id: "31cb99fc-6047-481d-9c0b-e0d6faae2fcb", nome: "empresas e mei", descricao: "Atendimento para empresas sem condições de pagar advogados e custas", idCategoriaAssuntoVerde: 10057 },
  { id: "60b16fa6-a265-42e2-b548-2ceea42e4fc5", nome: "erro médico", descricao: "Erro médico e falha no atendimento: pedidos de indenização e danos", idCategoriaAssuntoVerde: 10045 },
  { id: "1dc59849-fbee-4a39-879a-3b3656088009", nome: "escritura do imóvel", descricao: "Orientação sobre gratuidade para escritura e certidão de ônus reais", idCategoriaAssuntoVerde: 10090 },
  { id: "c1b3f113-5b2e-45e2-9ca9-ac5ba30bc1fd", nome: "falecimento na família", descricao: "Atendimento para herança, inventário e bens de parentes que faleceram", idCategoriaAssuntoVerde: 10017 },
  { id: "16ef5045-8ade-42b3-9843-727cf0cdd1e1", nome: "faq", descricao: "Perguntas frequentes sobre atendimento da Defensoria Pública.", idCategoriaAssuntoVerde: 10126 },
  { id: "1fdeea3a-9286-40b9-875c-1b7de80dd9ba", nome: "fgts", descricao: "Orientações sobre fgts", idCategoriaAssuntoVerde: 10069 },
  { id: "fc0224cb-20b6-4e80-bc56-f048eb67bb27", nome: "gratuidade documentos", descricao: "2ª via de documentos e correção de dados em certidões e registro civil", idCategoriaAssuntoVerde: 10038 },
  { id: "a029b11d-fd48-4ef7-a65b-26ebccc3a991", nome: "guarda", descricao: "Atendimento para regularizar a guarda de criança / adolescente", idCategoriaAssuntoVerde: 10042 },
  { id: "a246a56e-a4bb-454d-862a-663ad3622b28", nome: "imposto/taxa", descricao: "Impostos municipais ou estaduais: cobrança, dívidas e isenção.", idCategoriaAssuntoVerde: 10041 },
  { id: "b23e8161-49f3-480c-935b-3bbefd05532a", nome: "imóvel", descricao: "Problemas com imóvel, aluguel, condomínio, posse ou direito à moradia", idCategoriaAssuntoVerde: 10022 },
  { id: "9ceda0e8-b792-4419-934b-67ad3667d706", nome: "loas", descricao: "Para bpc/loas ou amparo social, busque a defensoria da união (dpu)", idCategoriaAssuntoVerde: 10092 },
  { id: "c856c169-9581-42e9-b527-72dca6b1d639", nome: "mediação", descricao: "Atendimento sobre mediação de conflitos.", idCategoriaAssuntoVerde: 10073 },
  { id: "9d29d196-2fc8-4514-ad1b-45f497e8402a", nome: "minha casa, minha vida", descricao: "Atendimento para questões envolvendo o programa minha casa, minha vida.", idCategoriaAssuntoVerde: 10091 },
  { id: "fe68a29d-e1e0-465c-a490-9e532e785c14", nome: "nascimento", descricao: "Dna, reconhecer pai ou mãe e problemas com certidão de nascimento", idCategoriaAssuntoVerde: 10028 },
  { id: "cba25887-86c3-4ce5-8dc0-c771a830e9cd", nome: "obter prontuário médico", descricao: "Atendimento quando a recusa do hospital em fornecer o prontuário médico", idCategoriaAssuntoVerde: 10115 },
  { id: "63ece0e5-1f89-489d-9c21-27013a4cfbde", nome: "paternidade", descricao: "Investigação de paternidade, exame de dna e nome do pai na certidão", idCategoriaAssuntoVerde: 10029 },
  { id: "3e74ff06-c3f7-400d-957d-957021ea9572", nome: "pedidos de indenização", descricao: "Indenização por danos contra empresas, órgãos públicos ou pessoas", idCategoriaAssuntoVerde: 10055 },
  { id: "89209462-6276-42c9-9c06-62628783dc6d", nome: "pensão alimentícia", descricao: "Atendimento sobre pensão alimentícia", idCategoriaAssuntoVerde: 10016 },
  { id: "26635f4e-5cb1-46fd-81b8-0e71453c385c", nome: "pessoas desaparecidas", descricao: "Orientação para auxílio na busca de pessoas desaparecidas", idCategoriaAssuntoVerde: 10130 },
  { id: "915c97ae-16ff-414a-87bc-9e9ce1d84c73", nome: "prisão civil (alimentos)", descricao: "Prisão por dívida de pensão alimentícia", idCategoriaAssuntoVerde: 10121 },
  { id: "7585190d-81ca-4b47-bb45-e50fbfd6e470", nome: "prisão em flagrante", descricao: "Atendimento sobre prisão em flagrante.", idCategoriaAssuntoVerde: 10111 },
  { id: "c42fa9de-3dd8-4860-a2bf-e2add61c4b02", nome: "processo administrativo", descricao: "Atendimento para processos administrativos", idCategoriaAssuntoVerde: 10093 },
  { id: "fe9e8dad-8caf-4a0b-a636-2d7a1af52ace", nome: "protesto de títulos", descricao: "Atendimento para a isenção da taxa de baixa do protesto de título", idCategoriaAssuntoVerde: 10078 },
  { id: "74b9f770-c3bf-442c-8e9d-3181ae068f9e", nome: "queixa-crime", descricao: "Crimes de menor potencial: ação penal iniciada pela própria vítima", idCategoriaAssuntoVerde: 10110 },
  { id: "1854cf60-119f-4111-94e7-a170d5ab406c", nome: "reclamação trabalhista", descricao: "Não atuamos em casos trabalhistas. procure o sindicato da sua categoria", idCategoriaAssuntoVerde: 10085 },
  { id: "a8f33628-c84b-417b-879e-c55725240d8e", nome: "regulamentar visita", descricao: "Direito de visitas: crianças, adolescentes, idosos e pessoas presas", idCategoriaAssuntoVerde: 10030 },
  { id: "6fffc351-ad03-456d-b3c0-c8bb5d9e653f", nome: "relação de consumo", descricao: "Atendimento relacionado à defesa do consumidor", idCategoriaAssuntoVerde: 10063 },
  { id: "4b8ce25b-df59-43ee-a761-eba508a81e8b", nome: "renúncia advogado", descricao: "Transferir processo para a defensoria", idCategoriaAssuntoVerde: 10076 },
  { id: "ec20bc4a-560e-4d4a-bd00-f80718c2c3eb", nome: "representar outra pessoa", descricao: "Orientações sobre como representar outra pessoa em processo ou atendimento.", idCategoriaAssuntoVerde: 10046 },
  { id: "d766f781-5bb5-4b87-b1b0-5a6600fef7e4", nome: "riocard - passe livre", descricao: "Atendimento relacionado ao riocard e passe livre", idCategoriaAssuntoVerde: 10075 },
  { id: "b670024b-a9a2-4e98-8f16-f5d9ba5402bc", nome: "saúde", descricao: "Atendimento para acesso à rede de saúde pública ou particular", idCategoriaAssuntoVerde: 10049 },
  { id: "0fe55283-4353-4cb3-8753-df073bb1f8d3", nome: "sentença de outro país", descricao: "Atendimento sobre homologação ou reconhecimento de sentença estrangeira no Brasil.", idCategoriaAssuntoVerde: 10070 },
  { id: "f6131969-3afa-4600-8d1b-6acffd898596", nome: "validar rg estrangeiro", descricao: "Validar identidade de estrangeiro gratuitamente", idCategoriaAssuntoVerde: 10068 },
];
