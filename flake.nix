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
            nodejs_24
            bubblewrap # For unprivileged sandboxing
            vscode
            claude-code
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
