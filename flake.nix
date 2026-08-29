{
  description = "rvmf — Retblast's Vibecoded Mitra Frontend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # Pinned upstream release used by the E2E fixture. Upstream ships
        # amd64 debs only, so the server package is x86_64-linux only.
        mitraVersion = "5.10.0";
        isX86 = system == "x86_64-linux";

        # onnxruntime-node (a transitive dep of @huggingface/transformers) runs a
        # postinstall that tries to fetch CUDA binaries from api.nuget.org, which
        # never resolves inside the network-less sandbox. This app uses the
        # WebGPU/WASM backend, never the native node backend, so the download is
        # safely skipped via the documented env-var escape hatch (the install
        # script reads ONNXRUNTIME_NODE_INSTALL). We apply it to both the npm
        # deps FOD fetch and the main build (which also runs `npm rebuild`).
        skipOrtInstall = attrs: attrs // {
          env = (attrs.env or { }) // { ONNXRUNTIME_NODE_INSTALL = "skip"; };
        };
        ortNpmDeps = (pkgs.fetchNpmDeps {
          name = "rvmf-0.1.0-npm-deps";
          src = ./.;
          hash = "sha256-TaQtRXoY5+TI+7klW9T0psZNxgUIXIZerIOTIk1v+UE=";
        }).overrideAttrs skipOrtInstall;
        mitraPkg = pkgs.stdenv.mkDerivation {
          pname = "mitra";
          version = mitraVersion;

          src = pkgs.fetchurl {
            url = "https://codeberg.org/silverpill/mitra/releases/download/v${mitraVersion}/mitra_${mitraVersion}_amd64.deb";
            hash = "sha256-W8BQn9Q0F/jWrCAefHXBDHdTNRqQKn6FeQTJLgukwRs=";
          };

          nativeBuildInputs = [ pkgs.dpkg pkgs.autoPatchelfHook ];
          buildInputs = [ pkgs.stdenv.cc.cc.lib ];

          unpackPhase = ''
            dpkg-deb -x $src .
          '';

          installPhase = ''
            mkdir -p $out
            cp -r usr/* $out/
          '';
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            postgresql_16
          ] ++ pkgs.lib.optionals isX86 [ mitraPkg ];

          shellHook = ''
            echo "rvmf dev shell — node $(node -v), npm $(npm -v)"
            if [ ! -d node_modules ]; then
              echo "Running npm install..."
              npm install
            fi
          '';
        };

        packages = rec {
          default = rvmf;

          rvmf = pkgs.buildNpmPackage {
            pname = "rvmf";
            version = "0.1.0";
            src = ./.;

            npmDeps = ortNpmDeps;

            env.ONNXRUNTIME_NODE_INSTALL = "skip";

            installPhase = ''
              mkdir -p $out
              cp -r dist/* $out/
            '';
          };

          mitra = if isX86 then mitraPkg
            else throw "packages.mitra: upstream only publishes amd64 debs";
        };

        apps.e2e = {
          type = "app";
          # Runs the working-tree script (call from the repo root): E2E
          # is a dev activity, and specs/scripts iterate too fast to be
          # useful from a frozen store path.
          program = toString (pkgs.writeShellScript "rvmf-e2e" ''
            export CHROMIUM_PATH="${pkgs.chromium}/bin/chromium"
            export PATH="${pkgs.postgresql_16}/bin:${pkgs.nodejs_22}/bin:$PATH"
            exec ${pkgs.bash}/bin/bash "''${RVMF_E2E_SCRIPT:-$PWD/scripts/e2e.sh}" "$@"
          '');
        };

        apps.default = self.apps.${system}.e2e;
      });
}
