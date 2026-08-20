{
  description = "Mitra GNOME/Adwaita-styled frontend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
          ];

          shellHook = ''
            echo "mitra-frontend dev shell — node $(node -v), npm $(npm -v)"
            if [ ! -d node_modules ]; then
              echo "Running npm install..."
              npm install
            fi
          '';
        };

        packages.default = pkgs.buildNpmPackage {
          pname = "mitra-frontend";
          version = "0.1.0";
          src = ./.;

          npmDepsHash = pkgs.lib.fakeHash;

          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };
      });
}
