{
  description = "Development environment for MidnightOS / NEAR Evaluation with Gemini CLI (Sandboxed)";

  inputs = {
    nixpkgs.url = "github:Nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            binaryen
            bubblewrap
            cargo
            claude-code
            ebook-convert
            gh
            mdbook
            mdbook-epub
            nodejs_24
            pandoc
            python3
            rustup
            vscode
            wabt
          ];

          shellHook = ''
            # Local npm prefix to avoid sudo
            export NPM_CONFIG_PREFIX="$PWD/.npm-global"
            export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

            # Check if gemini-cli is installed
            if ! command -v gemini &> /dev/null; then
              echo "Installing Gemini CLI into local prefix..."
              npm install -g @google/gemini-cli
            fi

            echo "🚀 Sandboxed Environment Active"
            echo "Use './gemini-sandbox.sh' to run Gemini with restricted filesystem access."
          '';
        };
      }
    );
}
