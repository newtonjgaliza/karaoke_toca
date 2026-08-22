// Configuração do Supabase para o Karaokê A Toca
// Substitua pelos dados do seu projeto no painel do Supabase

const SUPABASE_URL = "https://nlubuabtwbwizeltpeja.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_r2gLs8iIG8e2GALTR_KSzg_-MATK6R4";

// Inicializa o cliente do Supabase
// Certifique-se de que a biblioteca do Supabase foi carregada antes via CDN
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
