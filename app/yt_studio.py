#!/usr/bin/env python3
"""
YT Longform Studio - Aplikasi kontrol lokal (modern UI / CustomTkinter).

Fitur:
- Dashboard ringkasan + monitor video dari state hosting.
- Buat video di lokal (menjalankan pipeline Node) dengan log streaming.
- Trigger GitHub Action (cloud render) langsung dari aplikasi.
- Editor lengkap API key & kredensial (.env) dengan tampilan rapi.
- Pengaturan aplikasi disimpan di app/config.json.

Jalankan: python yt_studio.py  (atau klik run-app.bat)
"""

import json
import os
import queue
import subprocess
import threading
import webbrowser
import shutil
import zipfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import customtkinter as ctk
from tkinter import messagebox

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
CONFIG_PATH = APP_DIR / "config.json"
ENV_PATH = PROJECT_DIR / ".env"

# ---------------- Theme ----------------
COLORS = {
    "bg": "#0a0e14",
    "bg2": "#0f141d",
    "panel": "#131925",
    "panel2": "#1a2230",
    "border": "#232c3d",
    "text": "#e7eef7",
    "muted": "#8693a8",
    "accent": "#f5c84c",
    "accent_hover": "#e0a83a",
    "blue": "#58a6ff",
    "ok": "#2ea043",
    "err": "#f85149",
    "warn": "#d29922",
}

FONT = "Segoe UI"

DEFAULT_CONFIG = {
    "stateUrl": "https://yt.emsa.pro/state/items.json",
    "mediaBaseUrl": "https://yt.emsa.pro",
    "github": {
        "repo": "emsabiq/yt-longform",
        "workflow": "yt-longform-generate.yml",
        "ref": "main",
        "token": "",
    },
    "local": {"nodeCommand": "npm", "projectDir": str(PROJECT_DIR)},
}

# Definisi field .env yang bisa diedit lewat aplikasi.
ENV_SECTIONS = [
    ("OpenAI", [
        ("OPENAI_API_KEY", "API Key", True),
        ("OPENAI_BASE_URL", "Base URL", False),
        ("STORY_MODEL", "Story Model", False),
        ("IMAGE_MODEL", "Image Model", False),
        ("IMAGE_SIZE", "Image Size", False),
        ("IMAGE_QUALITY", "Image Quality", False),
        ("OPENAI_TTS_MODEL", "TTS Model", False),
        ("OPENAI_TTS_VOICE", "TTS Voice", False),
        ("OPENAI_TTS_SPEED", "Kecepatan TTS (default 1.08)", False),
        ("OPENAI_TTS_INSTRUCTIONS", "Gaya narator (opsional)", False),
        ("OPENAI_TRANSCRIBE_MODEL", "Transcribe Model", False),
    ]),
    ("Pexels Video (B-Roll)", [
        ("PEXELS_API_KEY", "Pexels API Key", True),
        ("PEXELS_PREFER_VIDEO", "Prefer Video (true/false)", False),
        ("PEXELS_MIN_DURATION_SEC", "Min Duration (detik)", False),
        ("PEXELS_MAX_RESULTS", "Max Results Search", False),
    ]),
    ("ElevenLabs (opsional)", [
        ("ELEVENLABS_API_KEY", "API Key", True),
        ("ELEVENLABS_MODEL", "Model", False),
        ("ELEVENLABS_VOICE_ID", "Voice ID", False),
    ]),
    ("YouTube Upload", [
        ("YOUTUBE_UPLOAD_ENABLED", "Aktif (true/false)", False),
        ("YOUTUBE_CLIENT_ID", "Client ID", True),
        ("YOUTUBE_CLIENT_SECRET", "Client Secret", True),
        ("YOUTUBE_REFRESH_TOKEN", "Refresh Token", True),
        ("YOUTUBE_PRIVACY_STATUS", "Privacy (public/unlisted/private)", False),
        ("YOUTUBE_CATEGORY_ID", "Category ID", False),
        ("YOUTUBE_DAILY_UPLOAD_LIMIT", "Batas upload/hari", False),
        ("YOUTUBE_PLAYLISTS", "Auto-Playlist (kategori:PLxxx,kategori2:PLyyy)", False),
        ("YOUTUBE_DEFAULT_PLAYLIST_ID", "Default Playlist ID", False),
    ]),
    ("Hosting / SFTP", [
        ("PUBLIC_BASE_URL", "Public Base URL", False),
        ("UPLOAD_DRIVER", "Driver (sftp/ftp)", False),
        ("SFTP_HOST", "SFTP Host", False),
        ("SFTP_PORT", "SFTP Port", False),
        ("SFTP_USER", "SFTP User", False),
        ("SFTP_PASSWORD", "SFTP Password", True),
        ("SFTP_REMOTE_DIR", "Remote Dir", False),
    ]),
    ("Otomatisasi", [
        ("AUTO_DASHBOARD_PIN", "Dashboard PIN", True),
        ("YT_DURATION_SEC", "Durasi default (detik)", False),
        ("YT_SCENE_COUNT", "Scene default", False),
        ("YT_DAILY_GENERATE_LIMIT", "Batas generate/hari", False),
        ("YT_TIME_ZONE", "Time Zone", False),
    ]),
]



# ---------------- Helpers ----------------
def deep_update(base, extra):
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_update(base[key], value)
        else:
            base[key] = value
    return base


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if CONFIG_PATH.exists():
        try:
            deep_update(cfg, json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as exc:  # noqa: BLE001
            print(f"config.json gagal dibaca: {exc}")
    return cfg


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def parse_env():
    data = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            data[key.strip()] = value.strip()
    return data


def write_env(updates):
    """Update .env mempertahankan baris lain & komentar."""
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    seen = set()
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")


def fmt_date(value):
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone().strftime("%d %b %Y %H:%M")
    except Exception:  # noqa: BLE001
        return str(value)


def fmt_dur(seconds):
    try:
        seconds = float(seconds)
    except (TypeError, ValueError):
        return "-"
    if not seconds:
        return "-"
    return f"{int(seconds // 60)}m {int(seconds % 60)}s"


# ---------------- Reusable widgets ----------------
class Card(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        super().__init__(master, fg_color=COLORS["panel"], corner_radius=14,
                         border_width=1, border_color=COLORS["border"], **kwargs)


class StatCard(ctk.CTkFrame):
    def __init__(self, master, label, value="0"):
        super().__init__(master, fg_color=COLORS["panel"], corner_radius=14,
                         border_width=1, border_color=COLORS["border"])
        self.value_lbl = ctk.CTkLabel(self, text=value, font=(FONT, 26, "bold"),
                                      text_color=COLORS["accent"])
        self.value_lbl.pack(anchor="w", padx=16, pady=(14, 0))
        ctk.CTkLabel(self, text=label, font=(FONT, 12), text_color=COLORS["muted"]).pack(
            anchor="w", padx=16, pady=(0, 14))

    def set(self, value):
        self.value_lbl.configure(text=str(value))


def section_title(master, text):
    return ctk.CTkLabel(master, text=text, font=(FONT, 16, "bold"), text_color=COLORS["text"])


# ---------------- Main App ----------------
class YTStudioApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.cfg = load_config()
        self.items = []
        self.log_queue = queue.Queue()
        self.env_vars = {}
        self.stat_cards = {}

        self.title("YT Longform Studio")
        self.geometry("1180x760")
        self.minsize(960, 640)
        self.configure(fg_color=COLORS["bg"])

        ctk.set_appearance_mode("dark")

        # Check system dependencies
        missing = self.check_dependencies()
        if missing:
            self._build_setup_wizard(missing)
        else:
            self._start_app()

    def _start_app(self):
        self.setup_local_paths()
        self._build_layout()
        self.show_view("dashboard")
        self.after(300, self.refresh_state)
        self.after(120, self._drain_log)
        self._tick_clock()

    def check_dependencies(self):
        missing = []
        
        # 1. Check Node
        node_global = shutil.which("node")
        node_local = (PROJECT_DIR / "bin" / "node" / "node.exe").exists()
        if not node_global and not node_local:
            missing.append("node")
            
        # 2. Check FFmpeg
        ffmpeg_global = shutil.which("ffmpeg")
        ffmpeg_local = False
        ffmpeg_dir = PROJECT_DIR / "bin" / "ffmpeg"
        if ffmpeg_dir.exists():
            for p in ffmpeg_dir.glob("**/ffmpeg.exe"):
                ffmpeg_local = True
                break
        if not ffmpeg_global and not ffmpeg_local:
            missing.append("ffmpeg")
            
        # 3. Check node_modules
        if not (PROJECT_DIR / "node_modules").exists():
            missing.append("node_modules")
            
        return missing

    def setup_local_paths(self):
        bin_dir = PROJECT_DIR / "bin"
        if not bin_dir.exists():
            return
            
        # Add local Node to PATH
        node_bin = bin_dir / "node"
        if node_bin.exists():
            os.environ["PATH"] = str(node_bin) + os.pathsep + os.environ["PATH"]
            
        # Add local FFmpeg to PATH
        ffmpeg_bin = None
        ffmpeg_dir = bin_dir / "ffmpeg"
        if ffmpeg_dir.exists():
            for p in ffmpeg_dir.glob("**/ffmpeg.exe"):
                ffmpeg_bin = p.parent
                break
        if ffmpeg_bin:
            os.environ["PATH"] = str(ffmpeg_bin) + os.pathsep + os.environ["PATH"]

    def _build_setup_wizard(self, missing):
        self.setup_frame = ctk.CTkFrame(self, fg_color=COLORS["bg"])
        self.setup_frame.pack(fill="both", expand=True)
        
        card = Card(self.setup_frame)
        card.place(relx=0.5, rely=0.5, anchor="center", width=540, height=440)
        
        # Title
        ctk.CTkLabel(card, text="Setup Dependensi Portabel", font=(FONT, 20, "bold"), text_color=COLORS["accent"]).pack(pady=(30, 10))
        
        desc = ("Aplikasi ini berjalan secara lokal dan memerlukan beberapa program pendukung "
                "berikut di komputer Anda agar dapat me-render dan meng-upload video.")
        ctk.CTkLabel(card, text=desc, font=(FONT, 12), text_color=COLORS["text"], wraplength=480, justify="center").pack(pady=(0, 20))
        
        # Status list
        status_box = ctk.CTkFrame(card, fg_color=COLORS["bg2"], corner_radius=10, border_width=1, border_color=COLORS["border"])
        status_box.pack(fill="x", padx=40, pady=10)
        
        # Check node
        node_status = "❌ Tidak ditemukan" if "node" in missing else "✔ Terpasang"
        node_color = COLORS["err"] if "node" in missing else COLORS["ok"]
        f1 = ctk.CTkFrame(status_box, fg_color="transparent")
        f1.pack(fill="x", padx=16, pady=8)
        ctk.CTkLabel(f1, text="Node.js Engine (Runtime)", font=(FONT, 12, "bold"), text_color=COLORS["text"]).pack(side="left")
        ctk.CTkLabel(f1, text=node_status, font=(FONT, 12), text_color=node_color).pack(side="right")
        
        # Check ffmpeg
        ffmpeg_status = "❌ Tidak ditemukan" if "ffmpeg" in missing else "✔ Terpasang"
        ffmpeg_color = COLORS["err"] if "ffmpeg" in missing else COLORS["ok"]
        f2 = ctk.CTkFrame(status_box, fg_color="transparent")
        f2.pack(fill="x", padx=16, pady=8)
        ctk.CTkLabel(f2, text="FFmpeg Multimedia (Renderer)", font=(FONT, 12, "bold"), text_color=COLORS["text"]).pack(side="left")
        ctk.CTkLabel(f2, text=ffmpeg_status, font=(FONT, 12), text_color=ffmpeg_color).pack(side="right")
        
        # Check node_modules
        modules_status = "❌ Tidak lengkap" if "node_modules" in missing else "✔ Terpasang"
        modules_color = COLORS["err"] if "node_modules" in missing else COLORS["ok"]
        f3 = ctk.CTkFrame(status_box, fg_color="transparent")
        f3.pack(fill="x", padx=16, pady=8)
        ctk.CTkLabel(f3, text="Node Modules (Library)", font=(FONT, 12, "bold"), text_color=COLORS["text"]).pack(side="left")
        ctk.CTkLabel(f3, text=modules_status, font=(FONT, 12), text_color=modules_color).pack(side="right")
        
        # Installer progress UI
        self.setup_status = ctk.CTkLabel(card, text="Klik tombol di bawah untuk memasang otomatis.", font=(FONT, 12), text_color=COLORS["muted"])
        self.setup_status.pack(pady=(20, 4))
        
        self.setup_bar = ctk.CTkProgressBar(card, height=10, corner_radius=5, progress_color=COLORS["accent"], fg_color=COLORS["bg2"], width=460)
        self.setup_bar.set(0)
        self.setup_bar.pack(pady=(0, 20))
        
        # Action button
        self.btn_install = ctk.CTkButton(card, text="⚡ Pasang Otomatis Dependensi Portabel", height=40, corner_radius=10,
                                         fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"], text_color="#1a1407",
                                         font=(FONT, 13, "bold"), command=self.start_dependency_installation)
        self.btn_install.pack(pady=(0, 20))

    def start_dependency_installation(self):
        self.btn_install.configure(state="disabled", text="Memasang...")
        self.setup_status.configure(text="Menyiapkan folder...", text_color=COLORS["accent"])
        self.setup_bar.set(0)
        threading.Thread(target=self._run_installation, daemon=True).start()

    def _run_installation(self):
        try:
            bin_dir = PROJECT_DIR / "bin"
            bin_dir.mkdir(exist_ok=True)
            
            missing = self.check_dependencies()
            
            # 1. Download & Extract Node.js if missing
            if "node" in missing:
                node_zip = bin_dir / "node.zip"
                url = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
                self._download_file(url, node_zip, "Mengunduh Node.js Portabel")
                
                self._update_setup_status("Mengekstrak Node.js...", 0.9)
                self._extract_zip(node_zip, bin_dir)
                
                # Rename the extracted folder to "node"
                extracted_folder = bin_dir / "node-v20.11.1-win-x64"
                target_folder = bin_dir / "node"
                if target_folder.exists():
                    shutil.rmtree(target_folder)
                if extracted_folder.exists():
                    extracted_folder.rename(target_folder)
                    
                # Clean up zip
                if node_zip.exists():
                    node_zip.unlink()
                    
            # 2. Download & Extract FFmpeg if missing
            if "ffmpeg" in missing:
                ffmpeg_zip = bin_dir / "ffmpeg.zip"
                url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
                self._download_file(url, ffmpeg_zip, "Mengunduh FFmpeg")
                
                self._update_setup_status("Mengekstrak FFmpeg...", 0.9)
                self._extract_zip(ffmpeg_zip, bin_dir)
                
                # Find the extracted folder (it starts with ffmpeg-)
                extracted_folder = None
                for p in bin_dir.iterdir():
                    if p.is_dir() and p.name.startswith("ffmpeg-") and p.name != "node" and p.name != "ffmpeg":
                        extracted_folder = p
                        break
                
                if extracted_folder:
                    target_folder = bin_dir / "ffmpeg"
                    if target_folder.exists():
                        shutil.rmtree(target_folder)
                    extracted_folder.rename(target_folder)
                    
                # Clean up zip
                if ffmpeg_zip.exists():
                    ffmpeg_zip.unlink()
            
            # Setup PATH variables so npm can be run
            self.setup_local_paths()
            
            # 3. Install node_modules if missing (we check it again)
            if not (PROJECT_DIR / "node_modules").exists() or "node_modules" in missing:
                self._update_setup_status("Memasang dependensi proyek (npm install)...", 0.95)
                npm_cmd = "npm"
                node_bin = bin_dir / "node"
                if node_bin.exists():
                    npm_cmd = str(node_bin / "npm.cmd")
                
                proc = subprocess.Popen([npm_cmd, "install"], cwd=str(PROJECT_DIR),
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, shell=True)
                for line in proc.stdout:
                    clean_line = line.strip()
                    if clean_line:
                        self._update_setup_status(f"NPM: {clean_line[:60]}...", 0.95)
                proc.wait()
                
            self._update_setup_status("Semua dependensi terpasang! Membuka studio...", 1.0)
            self.after(1000, self._complete_setup)
            
        except Exception as exc:
            self.after(0, lambda e=str(exc): self._setup_failed(e))

    def _download_file(self, url, dest_path, label):
        self._update_setup_status(f"{label}: Menghubungkan...", 0)
        
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        req = urllib.request.Request(url, headers=headers)
        
        with urllib.request.urlopen(req) as response, open(dest_path, "wb") as out_file:
            total_size = int(response.info().get("Content-Length", 0))
            downloaded = 0
            block_size = 1024 * 64
            
            while True:
                buffer = response.read(block_size)
                if not buffer:
                    break
                downloaded += len(buffer)
                out_file.write(buffer)
                
                if total_size > 0:
                    pct = downloaded / total_size
                    mb_downloaded = downloaded / (1024 * 1024)
                    mb_total = total_size / (1024 * 1024)
                    self._update_setup_status(
                        f"{label}: {mb_downloaded:.1f}MB / {mb_total:.1f}MB ({int(pct * 100)}%)",
                        pct * 0.9
                    )
                else:
                    self._update_setup_status(f"{label}: {downloaded / (1024*1024):.1f}MB", 0.5)

    def _extract_zip(self, zip_path, dest_dir):
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(dest_dir)

    def _update_setup_status(self, text, pct):
        self.after(0, lambda: self.setup_status.configure(text=text))
        self.after(0, lambda: self.setup_bar.set(pct))

    def _setup_failed(self, err_msg):
        self.btn_install.configure(state="normal", text="⚡ Coba Lagi")
        self.setup_status.configure(text=f"ERROR: {err_msg}", text_color=COLORS["err"])
        messagebox.showerror("Gagal Setup", f"Proses pemasangan otomatis gagal:\n{err_msg}")

    def _complete_setup(self):
        self.setup_frame.destroy()
        self._start_app()

    # ---------- Layout ----------
    def _build_layout(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)
        self._build_sidebar()
        self._build_main()

    def _build_sidebar(self):
        bar = ctk.CTkFrame(self, width=210, fg_color=COLORS["bg2"], corner_radius=0)
        bar.grid(row=0, column=0, sticky="nsw")
        bar.grid_propagate(False)

        brand = ctk.CTkFrame(bar, fg_color="transparent")
        brand.pack(fill="x", padx=18, pady=(22, 24))
        ctk.CTkLabel(brand, text="▶", font=(FONT, 22, "bold"),
                     text_color=COLORS["accent"]).pack(side="left")
        ctk.CTkLabel(brand, text="  YT Longform", font=(FONT, 17, "bold"),
                     text_color=COLORS["text"]).pack(side="left")

        self.nav_buttons = {}
        nav = [
            ("dashboard", "📊  Ringkasan"),
            ("create", "✨  Buat Video"),
            ("library", "🎬  Pustaka"),
            ("settings", "🔑  API & Kredensial"),
            ("app_settings", "⚙  Pengaturan Lokal"),
        ]
        for key, label in nav:
            btn = ctk.CTkButton(
                bar, text=label, anchor="w", height=42, corner_radius=10,
                fg_color="transparent", hover_color=COLORS["panel"],
                text_color=COLORS["muted"], font=(FONT, 14),
                command=lambda k=key: self.show_view(k))
            btn.pack(fill="x", padx=12, pady=3)
            self.nav_buttons[key] = btn

        foot = ctk.CTkFrame(bar, fg_color="transparent")
        foot.pack(side="bottom", fill="x", padx=12, pady=16)
        ctk.CTkButton(foot, text="↻  Refresh", height=34, corner_radius=9,
                      fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                      command=self.refresh_state).pack(fill="x", pady=3)
        self.clock_lbl = ctk.CTkLabel(foot, text="--:--", font=(FONT, 12),
                                      text_color=COLORS["muted"])
        self.clock_lbl.pack(pady=(8, 0))

    def _build_main(self):
        wrap = ctk.CTkFrame(self, fg_color="transparent")
        wrap.grid(row=0, column=1, sticky="nsew")
        wrap.grid_columnconfigure(0, weight=1)
        wrap.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(wrap, fg_color="transparent", height=64)
        header.grid(row=0, column=0, sticky="ew", padx=26, pady=(20, 6))
        self.view_kicker = ctk.CTkLabel(header, text="RINGKASAN", font=(FONT, 11, "bold"),
                                         text_color=COLORS["accent"])
        self.view_kicker.pack(anchor="w")
        self.view_title = ctk.CTkLabel(header, text="Operational Overview",
                                       font=(FONT, 22, "bold"), text_color=COLORS["text"])
        self.view_title.pack(anchor="w")
        self.status_lbl = ctk.CTkLabel(header, text="", font=(FONT, 12),
                                       text_color=COLORS["muted"])
        self.status_lbl.place(relx=1.0, rely=0.4, anchor="e")

        self.container = ctk.CTkFrame(wrap, fg_color="transparent")
        self.container.grid(row=1, column=0, sticky="nsew", padx=26, pady=(4, 20))
        self.container.grid_columnconfigure(0, weight=1)
        self.container.grid_rowconfigure(0, weight=1)

        self.views = {}
        self.views["dashboard"] = self._build_dashboard_view()
        self.views["create"] = self._build_create_view()
        self.views["library"] = self._build_library_view()
        self.views["settings"] = self._build_settings_view()
        self.views["app_settings"] = self._build_app_settings_view()

    VIEW_META = {
        "dashboard": ("RINGKASAN", "Operational Overview"),
        "create": ("BUAT VIDEO", "Generator Video Panjang"),
        "library": ("PUSTAKA", "Semua Video"),
        "settings": ("API & KREDENSIAL", "Editor Environment"),
        "app_settings": ("PENGATURAN APP", "Koneksi & GitHub"),
    }

    def show_view(self, key):
        for view in self.views.values():
            view.grid_forget()
        self.views[key].grid(row=0, column=0, sticky="nsew")
        for k, btn in self.nav_buttons.items():
            active = k == key
            btn.configure(fg_color=COLORS["panel2"] if active else "transparent",
                          text_color=COLORS["accent"] if active else COLORS["muted"])
        kicker, title = self.VIEW_META.get(key, ("", ""))
        self.view_kicker.configure(text=kicker)
        self.view_title.configure(text=title)
        if key == "settings":
            self._load_env_into_form()

    # ---------- Dashboard view ----------
    def _build_dashboard_view(self):
        view = ctk.CTkScrollableFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)

        stats = ctk.CTkFrame(view, fg_color="transparent")
        stats.pack(fill="x", pady=(0, 16))
        for i in range(4):
            stats.grid_columnconfigure(i, weight=1)
        labels = [("total", "Total Video"), ("uploaded", "Terupload"),
                  ("rendered", "Rendered"), ("today", "Hari Ini")]
        for i, (key, label) in enumerate(labels):
            card = StatCard(stats, label)
            card.grid(row=0, column=i, sticky="ew", padx=(0 if i == 0 else 10, 0))
            self.stat_cards[key] = card

        # Recent videos
        recent_card = Card(view)
        recent_card.pack(fill="both", expand=True)
        head = ctk.CTkFrame(recent_card, fg_color="transparent")
        head.pack(fill="x", padx=18, pady=(16, 8))
        section_title(head, "Video Terakhir").pack(side="left")
        ctk.CTkButton(head, text="Lihat semua", width=100, height=30, corner_radius=8,
                      fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                      command=lambda: self.show_view("library")).pack(side="right")
        self.recent_frame = ctk.CTkFrame(recent_card, fg_color="transparent")
        self.recent_frame.pack(fill="both", expand=True, padx=18, pady=(0, 16))
        return view

    # ---------- Create view ----------
    def _build_create_view(self):
        view = ctk.CTkScrollableFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)

        form_card = Card(view)
        form_card.pack(fill="x", pady=(0, 16))
        section_title(form_card, "  Parameter Video").pack(anchor="w", padx=18, pady=(16, 10))

        body = ctk.CTkFrame(form_card, fg_color="transparent")
        body.pack(fill="x", padx=18, pady=(0, 16))
        body.grid_columnconfigure((0, 1, 2), weight=1)

        self.f_topic = self._labeled_entry(body, "Topik (kosong = AI memilih)", 0, 0, span=3,
                                            placeholder="cth: Kenapa kapal baja bisa mengapung")
        self.f_category = self._labeled_combo(body, "Kategori", 1, 0,
                                              ["random", "sains", "penemuan", "sejarah",
                                               "tubuh manusia", "alam semesta", "teknologi",
                                               "benda sehari-hari", "tokoh dunia",
                                               "bahasa dan budaya", "makanan dan dapur",
                                               "material dan warna", "peta dan navigasi",
                                               "suara dan musik", "infrastruktur tersembunyi",
                                               "ekologi mikro", "ekonomi dan bisnis",
                                               "psikologi", "hewan dan tumbuhan",
                                               "luar angkasa", "arsitektur", "transportasi",
                                               "energi", "matematika sehari-hari",
                                               "misteri sejarah"])
        env_vars = parse_env()
        self.f_duration = self._labeled_combo(body, "Durasi (detik)", 1, 1,
                                              ["300", "360", "480", "600", "720", "900", "1200"],
                                              default=env_vars.get("YT_DURATION_SEC", "1200"),
                                              command=self.on_duration_change)
        self.f_scenes = self._labeled_combo(body, "Jumlah scene", 1, 2,
                                            ["10", "14", "18", "22", "26", "32", "36"], default="36")
        # Get defaults based on .env
        default_tts = env_vars.get("YT_TTS_PROVIDER", "openai")
        default_voice = env_vars.get("ELEVENLABS_VOICE_ID", "wUrGnU2Kx934kbDdOWDo") if default_tts == "elevenlabs" else env_vars.get("OPENAI_TTS_VOICE", "fable")

        self.f_tts = self._labeled_combo(body, "TTS provider", 2, 0, ["openai", "elevenlabs"], default=default_tts, command=self.on_tts_change)
        
        voice_choices = [default_voice] if default_tts == "elevenlabs" else ["fable", "ash", "ballad", "cedar", "shimmer", "verse"]
        self.f_voice = self._labeled_combo(body, "TTS voice", 2, 1, voice_choices, default=default_voice)
        self.f_quality = self._labeled_combo(body, "Kualitas gambar", 2, 2,
                                            ["low", "medium", "high"])

        self.f_force = ctk.CTkCheckBox(body, text="Paksa (abaikan batas harian)",
                                       fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"])
        self.f_force.select()
        self.f_force.grid(row=3, column=0, sticky="w", pady=(12, 0))

        self.f_upload = ctk.CTkCheckBox(body, text="Upload ke YouTube",
                                        fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"])
        self.f_upload.select()
        self.f_upload.grid(row=3, column=1, sticky="w", pady=(12, 0))

        self.f_remote = ctk.CTkCheckBox(body, text="Upload SFTP/Hosting",
                                        fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"])
        self.f_remote.deselect()
        self.f_remote.grid(row=3, column=2, sticky="w", pady=(12, 0))

        actions = ctk.CTkFrame(view, fg_color="transparent")
        actions.pack(fill="x", pady=(0, 16))
        self.btn_local = ctk.CTkButton(actions, text="▶  Jalankan Lokal (Node)", height=44,
                                       corner_radius=10, fg_color=COLORS["accent"],
                                       hover_color=COLORS["accent_hover"], text_color="#1a1407",
                                       font=(FONT, 14, "bold"), command=self.run_local)
        self.btn_local.pack(side="left", padx=(0, 10))
        ctk.CTkButton(actions, text="Bersihkan Log", height=44, corner_radius=10,
                      fg_color="transparent", hover_color=COLORS["panel"],
                      command=lambda: self.console.delete("1.0", "end")).pack(side="right")

        # Progress panel (live, per tahap)
        prog_card = Card(view)
        prog_card.pack(fill="x", pady=(0, 16))
        phead = ctk.CTkFrame(prog_card, fg_color="transparent")
        phead.pack(fill="x", padx=18, pady=(14, 6))
        section_title(phead, "Progres Proses").pack(side="left")
        self.prog_status = ctk.CTkLabel(phead, text="Menunggu...", font=(FONT, 12),
                                        text_color=COLORS["muted"])
        self.prog_status.pack(side="right")

        # Overall bar
        self.overall_bar = ctk.CTkProgressBar(prog_card, height=14, corner_radius=7,
                                              progress_color=COLORS["accent"],
                                              fg_color=COLORS["bg2"])
        self.overall_bar.set(0)
        self.overall_bar.pack(fill="x", padx=18, pady=(0, 4))
        self.overall_lbl = ctk.CTkLabel(prog_card, text="0%  -  idle", font=(FONT, 11),
                                        text_color=COLORS["muted"])
        self.overall_lbl.pack(anchor="w", padx=18, pady=(0, 10))

        # Per-stage rows
        self.stage_rows = {}
        stages = [("script", "Naskah"), ("images", "Gambar"), ("audio", "Suara TTS"),
                  ("thumbnail", "Thumbnail"), ("render", "Render Video"),
                  ("upload", "Upload"), ("publish", "Publish")]
        srow = ctk.CTkFrame(prog_card, fg_color="transparent")
        srow.pack(fill="x", padx=18, pady=(0, 14))
        srow.grid_columnconfigure(1, weight=1)
        for i, (key, label) in enumerate(stages):
            dot = ctk.CTkLabel(srow, text="○", font=(FONT, 14), text_color=COLORS["muted"], width=20)
            dot.grid(row=i, column=0, sticky="w", pady=2)
            name = ctk.CTkLabel(srow, text=label, font=(FONT, 12), text_color=COLORS["muted"], anchor="w")
            name.grid(row=i, column=1, sticky="ew", padx=(4, 8))
            bar = ctk.CTkProgressBar(srow, height=8, corner_radius=4,
                                     progress_color=COLORS["blue"], fg_color=COLORS["bg2"], width=180)
            bar.set(0)
            bar.grid(row=i, column=2, sticky="e", pady=2)
            pct = ctk.CTkLabel(srow, text="", font=(FONT, 11), text_color=COLORS["muted"], width=90, anchor="e")
            pct.grid(row=i, column=3, sticky="e", padx=(8, 0))
            self.stage_rows[key] = {"dot": dot, "name": name, "bar": bar, "pct": pct, "label": label}

        # Local output (muncul saat render lokal selesai)
        self.output_bar = ctk.CTkFrame(view, fg_color="transparent")
        self.output_bar.pack(fill="x", pady=(0, 16))
        self.output_path_value = None
        self.btn_open_file = ctk.CTkButton(self.output_bar, text="▶  Putar Video Hasil", height=40,
                                           corner_radius=10, fg_color=COLORS["accent"],
                                           hover_color=COLORS["accent_hover"], text_color="#1a1407",
                                           font=(FONT, 13, "bold"), command=self._open_output_file)
        self.btn_open_folder = ctk.CTkButton(self.output_bar, text="📁  Buka Folder", height=40,
                                             corner_radius=10, fg_color=COLORS["panel2"],
                                             hover_color=COLORS["border"], command=self._open_output_folder)
        self.meta_path_value = None
        self.btn_open_meta = ctk.CTkButton(self.output_bar, text="📝  Judul & Deskripsi", height=40,
                                           corner_radius=10, fg_color=COLORS["panel2"],
                                           hover_color=COLORS["border"], command=self._open_meta_file)

        # Console
        console_card = Card(view)
        console_card.pack(fill="both", expand=True)
        chead = ctk.CTkFrame(console_card, fg_color="transparent")
        chead.pack(fill="x", padx=18, pady=(16, 6))
        section_title(chead, "Konsol Proses").pack(side="left")
        self.spinner_lbl = ctk.CTkLabel(chead, text="", font=("Consolas", 13), text_color=COLORS["accent"])
        self.spinner_lbl.pack(side="right")
        self.console = ctk.CTkTextbox(console_card, fg_color="#060a10", corner_radius=10,
                                      font=("Consolas", 12), text_color="#c8d3e0", height=220)
        self.console.pack(fill="both", expand=True, padx=18, pady=(0, 16))
        self.console.insert("end", "Siap. Pilih parameter lalu jalankan.\n")
        return view

    def _labeled_entry(self, master, label, r, c, span=1, placeholder=""):
        wrap = ctk.CTkFrame(master, fg_color="transparent")
        wrap.grid(row=r, column=c, columnspan=span, sticky="ew", padx=(0, 12), pady=6)
        ctk.CTkLabel(wrap, text=label, font=(FONT, 12), text_color=COLORS["muted"]).pack(anchor="w")
        entry = ctk.CTkEntry(wrap, height=38, corner_radius=9, fg_color=COLORS["bg2"],
                             border_color=COLORS["border"], placeholder_text=placeholder)
        entry.pack(fill="x", pady=(4, 0))
        return entry

    def _labeled_combo(self, master, label, r, c, values, default=None, command=None):
        wrap = ctk.CTkFrame(master, fg_color="transparent")
        wrap.grid(row=r, column=c, sticky="ew", padx=(0, 12), pady=6)
        ctk.CTkLabel(wrap, text=label, font=(FONT, 12), text_color=COLORS["muted"]).pack(anchor="w")
        combo = ctk.CTkComboBox(wrap, values=values, height=38, corner_radius=9,
                                fg_color=COLORS["bg2"], border_color=COLORS["border"],
                                button_color=COLORS["panel2"], button_hover_color=COLORS["border"],
                                command=command)
        combo.set(default or values[0])
        combo.pack(fill="x", pady=(4, 0))
        return combo

    # ---------- Library view ----------
    def _build_library_view(self):
        view = ctk.CTkFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)
        view.grid_rowconfigure(1, weight=1)

        tools = ctk.CTkFrame(view, fg_color="transparent")
        tools.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.lib_search = ctk.CTkEntry(tools, placeholder_text="Cari judul / topik...",
                                       height=38, width=320, corner_radius=9,
                                       fg_color=COLORS["bg2"], border_color=COLORS["border"])
        self.lib_search.pack(side="left")
        self.lib_search.bind("<KeyRelease>", lambda _e: self._render_library())
        self.lib_filter = ctk.CTkComboBox(tools, values=["Semua", "Terupload", "Rendered", "Gagal"],
                                          height=38, width=160, corner_radius=9,
                                          fg_color=COLORS["bg2"], border_color=COLORS["border"],
                                          button_color=COLORS["panel2"],
                                          command=lambda _v: self._render_library())
        self.lib_filter.set("Semua")
        self.lib_filter.pack(side="left", padx=10)

        self.library_frame = ctk.CTkScrollableFrame(view, fg_color="transparent")
        self.library_frame.grid(row=1, column=0, sticky="nsew")
        self.library_frame.grid_columnconfigure((0, 1, 2), weight=1)
        return view

    # ---------- Settings (env) view ----------
    def _build_settings_view(self):
        view = ctk.CTkFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)
        view.grid_rowconfigure(0, weight=1)

        scroll = ctk.CTkScrollableFrame(view, fg_color="transparent")
        scroll.grid(row=0, column=0, sticky="nsew")
        scroll.grid_columnconfigure(0, weight=1)

        info = Card(scroll)
        info.pack(fill="x", pady=(0, 14))
        ctk.CTkLabel(info, text="Semua nilai disimpan ke file .env proyek. Field sensitif disamarkan; "
                     "klik 👁 untuk menampilkan.", font=(FONT, 12),
                     text_color=COLORS["muted"], wraplength=820, justify="left").pack(
            anchor="w", padx=18, pady=14)

        for sec_title, fields in ENV_SECTIONS:
            card = Card(scroll)
            card.pack(fill="x", pady=(0, 12))
            section_title(card, "  " + sec_title).pack(anchor="w", padx=18, pady=(14, 8))
            grid = ctk.CTkFrame(card, fg_color="transparent")
            grid.pack(fill="x", padx=18, pady=(0, 14))
            grid.grid_columnconfigure((0, 1), weight=1)
            for idx, (env_key, label, secret) in enumerate(fields):
                self._env_field(grid, env_key, label, secret, idx // 2, idx % 2)

        bar = ctk.CTkFrame(view, fg_color="transparent")
        bar.grid(row=1, column=0, sticky="ew", pady=(12, 0))
        ctk.CTkButton(bar, text="💾  Simpan ke .env", height=44, corner_radius=10,
                      fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"],
                      text_color="#1a1407", font=(FONT, 14, "bold"),
                      command=self.save_env).pack(side="left")
        ctk.CTkButton(bar, text="Muat ulang", height=44, corner_radius=10,
                      fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                      command=self._load_env_into_form).pack(side="left", padx=10)
        ctk.CTkButton(bar, text="Tes Preflight", height=44, corner_radius=10,
                      fg_color="transparent", hover_color=COLORS["panel"],
                      command=self.run_preflight).pack(side="right")
        return view

    def _env_field(self, master, env_key, label, secret, r, c):
        wrap = ctk.CTkFrame(master, fg_color="transparent")
        wrap.grid(row=r, column=c, sticky="ew", padx=(0, 14), pady=6)
        wrap.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(wrap, text=f"{label}  ({env_key})", font=(FONT, 11),
                     text_color=COLORS["muted"]).grid(row=0, column=0, columnspan=2, sticky="w")
        entry = ctk.CTkEntry(wrap, height=38, corner_radius=9, fg_color=COLORS["bg2"],
                             border_color=COLORS["border"], show="•" if secret else "")
        entry.grid(row=1, column=0, sticky="ew", pady=(4, 0))
        if secret:
            toggle = ctk.CTkButton(wrap, text="👁", width=40, height=38, corner_radius=9,
                                   fg_color=COLORS["panel2"], hover_color=COLORS["border"])
            toggle.grid(row=1, column=1, padx=(6, 0), pady=(4, 0))
            toggle.configure(command=lambda e=entry: e.configure(
                show="" if e.cget("show") else "•"))
        self.env_vars[env_key] = entry

    def _load_env_into_form(self):
        data = parse_env()
        for key, entry in self.env_vars.items():
            entry.delete(0, "end")
            entry.insert(0, data.get(key, ""))

    def save_env(self):
        updates = {}
        for key, entry in self.env_vars.items():
            value = entry.get().strip()
            if value:
                updates[key] = value
        if not updates:
            messagebox.showwarning("Kosong", "Tidak ada nilai untuk disimpan.")
            return
        try:
            write_env(updates)
            messagebox.showinfo("Tersimpan", f"{len(updates)} nilai disimpan ke .env")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Gagal", str(exc))

    # ---------- App settings view ----------
    def _build_app_settings_view(self):
        view = ctk.CTkScrollableFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)

        card = Card(view)
        card.pack(fill="x", pady=(0, 14))
        section_title(card, "  Pengaturan Lokal").pack(anchor="w", padx=18, pady=(14, 8))
        body = ctk.CTkFrame(card, fg_color="transparent")
        body.pack(fill="x", padx=18, pady=(0, 14))
        body.grid_columnconfigure(0, weight=1)

        self.app_fields = {}
        rows = [
            ("projectDir", "Folder proyek (lokasi package.json)", self.cfg["local"]["projectDir"], False),
            ("nodeCommand", "Perintah Node (default: npm)", self.cfg["local"].get("nodeCommand", "npm"), False),
        ]
        for i, (key, label, value, secret) in enumerate(rows):
            ctk.CTkLabel(body, text=label, font=(FONT, 12), text_color=COLORS["muted"]).grid(
                row=i * 2, column=0, sticky="w", pady=(8, 2))
            entry = ctk.CTkEntry(body, height=38, corner_radius=9, fg_color=COLORS["bg2"],
                                 border_color=COLORS["border"], show="•" if secret else "")
            entry.insert(0, value)
            entry.grid(row=i * 2 + 1, column=0, sticky="ew")
            self.app_fields[key] = entry

        ctk.CTkButton(view, text="💾  Simpan Pengaturan", height=44, corner_radius=10,
                      fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"],
                      text_color="#1a1407", font=(FONT, 14, "bold"),
                      command=self.save_app_settings).pack(anchor="w")

        note = Card(view)
        note.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(note, text="Aplikasi ini bekerja sepenuhnya lokal: render memakai FFmpeg di komputer ini "
                     "dan API key dari file .env. Tidak ada koneksi ke SFTP maupun GitHub. "
                     "Untuk pemantauan online dan otomasi terjadwal, gunakan dashboard-yt.emsa.pro.",
                     font=(FONT, 12), text_color=COLORS["muted"], wraplength=820,
                     justify="left").pack(anchor="w", padx=18, pady=14)
        return view

    def save_app_settings(self):
        self.cfg["local"]["projectDir"] = self.app_fields["projectDir"].get().strip()
        self.cfg["local"]["nodeCommand"] = self.app_fields["nodeCommand"].get().strip() or "npm"
        try:
            save_config(self.cfg)
            messagebox.showinfo("Tersimpan", "Pengaturan aplikasi disimpan.")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Gagal", str(exc))

    # ---------- Data ----------
    def refresh_state(self):
        self.status_lbl.configure(text="Memuat data lokal...")
        threading.Thread(target=self._load_local_items, daemon=True).start()

    def _load_local_items(self):
        project_dir = self.cfg["local"].get("projectDir") or str(PROJECT_DIR)
        items_file = Path(project_dir) / "data" / "items.json"
        try:
            if items_file.exists():
                data = json.loads(items_file.read_text(encoding="utf-8"))
                items = data if isinstance(data, list) else data.get("items", [])
            else:
                items = []
            items.sort(key=lambda it: str(it.get("updatedAt") or it.get("createdAt") or ""), reverse=True)
            self.items = items
            self.after(0, self._render_all)
        except Exception as exc:  # noqa: BLE001
            err = str(exc)
            self.after(0, lambda m=err: self.status_lbl.configure(text=f"Gagal baca data lokal: {m}"))

    def _render_all(self):
        self._render_stats()
        self._render_recent()
        self._render_library()
        self.status_lbl.configure(
            text=f"{len(self.items)} video \u00B7 {datetime.now().strftime('%H:%M:%S')}")

    def _status_of(self, it):
        if (it.get("publish") or {}).get("youtube", {}).get("url"):
            return "uploaded", "Terupload", COLORS["ok"]
        if it.get("status") == "rendered" or (it.get("assets") or {}).get("video"):
            return "rendered", "Rendered", COLORS["accent"]
        if (it.get("publish") or {}).get("errors", {}).get("youtube"):
            return "failed", "Gagal", COLORS["err"]
        return "draft", "Draft", COLORS["muted"]

    def _render_stats(self):
        today = datetime.now().strftime("%Y-%m-%d")
        uploaded = sum(1 for it in self.items if self._status_of(it)[0] == "uploaded")
        rendered = sum(1 for it in self.items if self._status_of(it)[0] in ("rendered", "uploaded"))
        today_count = sum(1 for it in self.items if str(it.get("createdAt", ""))[:10] == today)
        self.stat_cards["total"].set(len(self.items))
        self.stat_cards["uploaded"].set(uploaded)
        self.stat_cards["rendered"].set(rendered)
        self.stat_cards["today"].set(today_count)

    def _render_recent(self):
        for w in self.recent_frame.winfo_children():
            w.destroy()
        items = self.items[:6]
        if not items:
            ctk.CTkLabel(self.recent_frame, text="Belum ada video.",
                          text_color=COLORS["muted"]).pack(anchor="w")
            return
        for i in range(3):
            self.recent_frame.grid_columnconfigure(i, weight=1)
        for idx, it in enumerate(items):
            self._video_card(self.recent_frame, it, idx // 3, idx % 3)

    def _render_library(self):
        for w in self.library_frame.winfo_children():
            w.destroy()
        q = self.lib_search.get().lower().strip()
        flt = self.lib_filter.get()
        flt_map = {"Terupload": "uploaded", "Rendered": "rendered", "Gagal": "failed"}
        items = self.items
        if q:
            items = [it for it in items if q in f"{it.get('title','')} {it.get('input',{}).get('topic','')}".lower()]
        if flt in flt_map:
            items = [it for it in items if self._status_of(it)[0] == flt_map[flt]]
        if not items:
            ctk.CTkLabel(self.library_frame, text="Tidak ada video.",
                          text_color=COLORS["muted"]).grid(row=0, column=0, pady=30)
            return
        for idx, it in enumerate(items):
            self._video_card(self.library_frame, it, idx // 3, idx % 3)

    def _video_card(self, master, it, r, c):
        card = ctk.CTkFrame(master, fg_color=COLORS["panel2"], corner_radius=12,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=r, column=c, sticky="nsew", padx=8, pady=8)
        _key, status_text, status_color = self._status_of(it)
        title = it.get("title") or "(tanpa judul)"
        ctk.CTkLabel(card, text=status_text, font=(FONT, 11, "bold"), text_color=status_color).pack(
            anchor="w", padx=14, pady=(12, 2))
        ctk.CTkLabel(card, text=title, font=(FONT, 14, "bold"), text_color=COLORS["text"],
                     wraplength=240, justify="left").pack(anchor="w", padx=14)
        meta = f"{it.get('input', {}).get('category', '')} \u00B7 {fmt_date(it.get('createdAt'))}"
        ctk.CTkLabel(card, text=meta, font=(FONT, 11), text_color=COLORS["muted"]).pack(
            anchor="w", padx=14, pady=(2, 0))
        dur = (it.get("assets") or {}).get("video", {}).get("durationSec")
        ctk.CTkLabel(card, text=f"Durasi: {fmt_dur(dur)}", font=(FONT, 11),
                     text_color=COLORS["muted"]).pack(anchor="w", padx=14)
        yt_data = (it.get("publish") or {}).get("youtube", {})
        yt = yt_data.get("url")
        playlist_id = yt_data.get("playlist")
        if playlist_id:
            ctk.CTkLabel(card, text=f"📂 Playlist: {playlist_id[:20]}...", font=(FONT, 10),
                         text_color=COLORS["blue"]).pack(anchor="w", padx=14, pady=(2, 0))
        local_path = (it.get("assets") or {}).get("video", {}).get("path")
        if yt:
            btn = ctk.CTkButton(card, text="▶ Buka YouTube",
                                height=32, corner_radius=8,
                                fg_color=COLORS["accent"],
                                hover_color=COLORS["accent_hover"],
                                text_color="#1a1407",
                                command=lambda u=yt: webbrowser.open(u))
            btn.pack(fill="x", padx=14, pady=12)
        else:
            if local_path:
                btn_grid = ctk.CTkFrame(card, fg_color="transparent")
                btn_grid.pack(fill="x", padx=14, pady=12)
                
                btn_play = ctk.CTkButton(btn_grid, text="▶ Putar", height=32, width=90, corner_radius=8,
                                         fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                                         text_color=COLORS["text"],
                                         command=lambda p=local_path: self._play_local_file(p))
                btn_play.pack(side="left", expand=True, fill="x", padx=(0, 4))
                
                btn_up = ctk.CTkButton(btn_grid, text="☁ Upload", height=32, width=110, corner_radius=8,
                                       fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"],
                                       text_color="#1a1407",
                                       command=lambda i=it.get("id"): self.upload_to_youtube(i))
                btn_up.pack(side="right", expand=True, fill="x", padx=(4, 0))
            else:
                btn = ctk.CTkButton(card, text="Belum diupload",
                                    height=32, corner_radius=8,
                                    fg_color=COLORS["panel"],
                                    hover_color=COLORS["panel"],
                                    text_color=COLORS["muted"],
                                    state="disabled")
                btn.pack(fill="x", padx=14, pady=12)

    # ---------- Actions ----------
    def _params(self):
        return {
            "topic": self.f_topic.get().strip(),
            "category": self.f_category.get(),
            "durationSec": self.f_duration.get(),
            "sceneCount": self.f_scenes.get(),
            "ttsProvider": self.f_tts.get(),
            "ttsVoice": self.f_voice.get(),
            "imageQuality": self.f_quality.get(),
            "force": "true" if self.f_force.get() else "false",
            "upload": self.f_upload.get() == 1,
            "remote": self.f_remote.get() == 1,
        }

    def _log(self, msg):
        self.log_queue.put(msg)

    def _drain_log(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.console.insert("end", msg + "\n")
                self.console.see("end")
        except queue.Empty:
            pass
        self.after(120, self._drain_log)

    def run_local(self):
        p = self._params()
        project_dir = self.cfg["local"].get("projectDir") or str(PROJECT_DIR)
        node_cmd = self.cfg["local"].get("nodeCommand", "npm")
        cmd = [node_cmd, "run", "run:once", "--",
               "--topic", p["topic"], "--category", p["category"],
               "--duration", p["durationSec"], "--scenes", p["sceneCount"],
               "--tts-provider", p["ttsProvider"], "--tts-voice", p["ttsVoice"],
               "--image-quality", p["imageQuality"], "--force", p["force"]]
        
        if not p["upload"]:
            cmd.append("--no-upload")
        if not p["remote"]:
            cmd.append("--no-remote")

        self.show_view("create")
        self._reset_progress("Render lokal" + (" + Upload" if p["upload"] else " (tanpa upload)"))
        self._log(f"$ {' '.join(cmd)}")
        self.btn_local.configure(state="disabled", text="Sedang berjalan...")
        self._start_spinner()
        threading.Thread(target=self._run_subprocess, args=(cmd, project_dir), daemon=True).start()

    def on_duration_change(self, val):
        mapping = {
            "300": "10",
            "360": "12",
            "480": "14",
            "600": "18",
            "720": "22",
            "900": "26",
            "1200": "36"
        }
        if val in mapping and hasattr(self, "f_scenes"):
            self.f_scenes.set(mapping[val])

    def on_tts_change(self, val):
        if val == "elevenlabs":
            env_voice = parse_env().get("ELEVENLABS_VOICE_ID", "wUrGnU2Kx934kbDdOWDo")
            self.f_voice.configure(values=[env_voice])
            self.f_voice.set(env_voice)
        else:
            self.f_voice.configure(values=["fable", "ash", "ballad", "cedar", "shimmer", "verse"])
            self.f_voice.set("fable")

    def upload_to_youtube(self, item_id):
        project_dir = self.cfg["local"].get("projectDir") or str(PROJECT_DIR)
        node_cmd = self.cfg["local"].get("nodeCommand", "npm")
        cmd = [node_cmd, "run", "upload:once", "--", "--id", item_id]
        
        self.show_view("create")
        self._reset_progress("Upload ke YouTube")
        # Mark script, images, audio, thumbnail, render as complete since we are only uploading
        for stage in ["script", "images", "audio", "thumbnail", "render"]:
            if stage in self.stage_rows:
                row = self.stage_rows[stage]
                row["bar"].set(1)
                row["dot"].configure(text="✔", text_color=COLORS["ok"])
                row["pct"].configure(text="100% (lewati)")
        
        self._log(f"$ {' '.join(cmd)}")
        self.btn_local.configure(state="disabled", text="Sedang berjalan...")
        self._start_spinner()
        threading.Thread(target=self._run_subprocess, args=(cmd, project_dir), daemon=True).start()

    def _play_local_file(self, path):
        if path and Path(path).exists():
            try:
                os.startfile(path)
            except AttributeError:
                webbrowser.open(f"file://{path}")
        else:
            messagebox.showwarning("File tidak ada", f"File video tidak ditemukan di: {path}")

    def _run_subprocess(self, cmd, cwd):
        success = False
        try:
            proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, bufsize=1,
                                    shell=(os.name == "nt"))
            for raw in proc.stdout:
                line = raw.rstrip()
                if "@@PROGRESS" in line:
                    self._parse_progress(line)
                    continue
                if "@@LOCAL_OUTPUT" in line:
                    self._parse_local_output(line)
                    continue
                if "@@UPLOAD_SUCCESS" in line:
                    self._parse_upload_success(line)
                    continue
                self._log(line)
            proc.wait()
            success = proc.returncode == 0
            self._log(f"--- selesai (exit {proc.returncode}) ---")
        except FileNotFoundError:
            self._log("ERROR: node/npm tidak ditemukan. Cek PATH atau folder proyek.")
        except Exception as exc:  # noqa: BLE001
            err = str(exc)
            self._log(f"ERROR: {err}")
        finally:
            self.after(0, self._stop_spinner)
            self.after(0, lambda: self.btn_local.configure(
                state="normal", text="▶  Jalankan Lokal (Node)"))
            if success:
                self.after(1500, self.refresh_state)
                self.after(0, lambda: self._set_status_text("Selesai", COLORS["ok"]))

    def _parse_upload_success(self, line):
        try:
            start = line.index("@@UPLOAD_SUCCESS") + len("@@UPLOAD_SUCCESS")
            end = line.rindex("@@")
            data = json.loads(line[start:end].strip())
        except Exception:  # noqa: BLE001
            return
        url = data.get("url", "")
        self.after(0, lambda u=url: self._show_upload_success(u))

    def _show_upload_success(self, url):
        self._log(f"✓ Sukses upload ke YouTube: {url}")
        if "upload" in self.stage_rows:
            row = self.stage_rows["upload"]
            row["bar"].set(1)
            row["dot"].configure(text="✔", text_color=COLORS["ok"])
            row["pct"].configure(text="100%")
        if "publish" in self.stage_rows:
            row = self.stage_rows["publish"]
            row["bar"].set(1)
            row["dot"].configure(text="✔", text_color=COLORS["ok"])
            row["pct"].configure(text="Selesai")
        self.overall_bar.set(1)
        self.overall_lbl.configure(text="100% - Selesai Upload")

    # ---------- Progress & output helpers ----------
    STAGE_KEYS = ["script", "images", "audio", "thumbnail", "render", "upload", "publish"]

    def _reset_progress(self, status="Memproses..."):
        self.overall_bar.set(0)
        self.overall_lbl.configure(text="0%  -  mulai")
        self.prog_status.configure(text=status, text_color=COLORS["accent"])
        for key, row in self.stage_rows.items():
            row["bar"].set(0)
            row["dot"].configure(text="○", text_color=COLORS["muted"])
            row["name"].configure(text_color=COLORS["muted"])
            row["pct"].configure(text="")
        self.output_path_value = None
        self.btn_open_file.pack_forget()
        self.btn_open_folder.pack_forget()
        if hasattr(self, "btn_open_meta"):
            self.btn_open_meta.pack_forget()

    def _parse_progress(self, line):
        try:
            start = line.index("@@PROGRESS") + len("@@PROGRESS")
            end = line.rindex("@@")
            data = json.loads(line[start:end].strip())
        except Exception:  # noqa: BLE001
            return
        self.after(0, lambda d=data: self._apply_progress(d))

    def _apply_progress(self, d):
        stage = d.get("stage")
        percent = d.get("percent")
        overall = d.get("overall")
        detail = d.get("detail", "")
        label = d.get("label", "")
        if overall is not None:
            self.overall_bar.set(max(0, min(100, overall)) / 100)
            self.overall_lbl.configure(text=f"{overall}%  -  {label}")
        self.prog_status.configure(text=label or "Memproses...", text_color=COLORS["accent"])
        if stage in self.stage_rows:
            # mark previous stages done
            idx = self.STAGE_KEYS.index(stage) if stage in self.STAGE_KEYS else -1
            for i, key in enumerate(self.STAGE_KEYS):
                if key not in self.stage_rows:
                    continue
                row = self.stage_rows[key]
                if idx >= 0 and i < idx:
                    row["bar"].set(1)
                    row["dot"].configure(text="✔", text_color=COLORS["ok"])
                    row["pct"].configure(text="100%")
            row = self.stage_rows[stage]
            pv = percent if percent is not None else 0
            row["bar"].set(max(0, min(100, pv)) / 100)
            row["name"].configure(text_color=COLORS["text"])
            if pv >= 100:
                row["dot"].configure(text="✔", text_color=COLORS["ok"])
            else:
                row["dot"].configure(text="●", text_color=COLORS["accent"])
            row["pct"].configure(text=(f"{pv}%" + (f"  {detail}" if detail else "")))

    def _parse_local_output(self, line):
        try:
            start = line.index("@@LOCAL_OUTPUT") + len("@@LOCAL_OUTPUT")
            end = line.rindex("@@")
            data = json.loads(line[start:end].strip())
        except Exception:  # noqa: BLE001
            return
        path = data.get("path", "")
        meta = data.get("metaPath", "")
        self.after(0, lambda p=path, m=meta: self._show_output(p, m))

    def _show_output(self, path, meta_path=""):
        self.output_path_value = path
        self.meta_path_value = meta_path
        if path:
            self._log(f"✓ Video tersimpan: {path}")
            self.btn_open_file.pack(side="left", padx=(0, 10))
            self.btn_open_folder.pack(side="left")
        if meta_path:
            self._log(f"✓ Judul & deskripsi YouTube: {meta_path}")
            self.btn_open_meta.pack(side="left", padx=(10, 0))
        for key, row in self.stage_rows.items():
            if key in ("upload", "publish"):
                row["pct"].configure(text="dilewati (lokal)")

    def _open_output_file(self):
        if self.output_path_value and Path(self.output_path_value).exists():
            try:
                os.startfile(self.output_path_value)  # noqa: B606 (Windows)
            except AttributeError:
                webbrowser.open(f"file://{self.output_path_value}")
        else:
            messagebox.showwarning("Tidak ada", "File hasil belum tersedia.")

    def _open_output_folder(self):
        if self.output_path_value:
            folder = str(Path(self.output_path_value).parent)
            try:
                os.startfile(folder)  # noqa: B606
            except AttributeError:
                webbrowser.open(f"file://{folder}")

    def _open_meta_file(self):
        if getattr(self, "meta_path_value", None) and Path(self.meta_path_value).exists():
            try:
                os.startfile(self.meta_path_value)  # noqa: B606
            except AttributeError:
                webbrowser.open(f"file://{self.meta_path_value}")
        else:
            messagebox.showinfo("Belum ada", "File judul & deskripsi belum tersedia.")

    def _set_status_text(self, text, color):
        self.prog_status.configure(text=text, text_color=color)

    def _start_spinner(self):
        self._spinning = True
        self._spin_i = 0
        self._spin_t0 = datetime.now()
        self._spin()

    def _spin(self):
        if not getattr(self, "_spinning", False):
            return
        frames = "|/-\\"
        self._spin_i = (self._spin_i + 1) % len(frames)
        elapsed = int((datetime.now() - self._spin_t0).total_seconds())
        mm, ss = divmod(elapsed, 60)
        self.spinner_lbl.configure(text=f"{frames[self._spin_i]}  {mm:02d}:{ss:02d} berjalan")
        self.after(250, self._spin)

    def _stop_spinner(self):
        self._spinning = False
        if hasattr(self, "_spin_t0"):
            elapsed = int((datetime.now() - self._spin_t0).total_seconds())
            mm, ss = divmod(elapsed, 60)
            self.spinner_lbl.configure(text=f"selesai dalam {mm:02d}:{ss:02d}")

    def run_preflight(self):
        project_dir = self.cfg["local"].get("projectDir") or str(PROJECT_DIR)
        node_cmd = self.cfg["local"].get("nodeCommand", "npm")
        self.show_view("create")
        self._log("$ npm run preflight")
        threading.Thread(target=self._run_subprocess,
                         args=([node_cmd, "run", "preflight"], project_dir), daemon=True).start()

    def _tick_clock(self):
        self.clock_lbl.configure(text=datetime.now().strftime("%H:%M:%S"))
        self.after(1000, self._tick_clock)


def main():
    app = YTStudioApp()
    app.mainloop()


if __name__ == "__main__":
    main()
