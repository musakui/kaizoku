use dash_mpd::fetch::DashDownloader;
use dash_mpd::fetch::ProgressObserver;

struct ProgressPrint {}

impl ProgressPrint {
    pub fn new() -> Self {
        Self {}
    }
}

impl ProgressObserver for ProgressPrint {
    fn update(&self, percent: u32, message: &str) {
        println!("[{percent:?}] {message:?}");
    }
}

#[tokio::main]
async fn main () {
    let kid = std::env::args().nth(1).expect("no kid");
    let key = std::env::args().nth(2).expect("no key");
    let out = std::env::args().nth(3).expect("no out");
    let url = std::env::args().nth(4).expect("no url");
    let dl = DashDownloader::new(url.as_str())
        .best_quality()
        .add_decryption_key(kid, key)
        .add_progress_observer(std::sync::Arc::new(ProgressPrint::new()));
    match dl.download_to(out.as_str()).await {
        Err(e) => {
            eprintln!("Download failed: {e:?}");
            std::process::exit(2);
        }
        Ok(pth) => {
            println!("[100] Complete {pth:?}");
        }
    }
}
