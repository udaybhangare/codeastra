# Tenant worker image: static Go binary on scratch, runs as non-root.
# The binary is built on the host first (no golang image pull needed):
#   make worker-image
# which runs: CGO_ENABLED=0 GOOS=linux go build -o worker/worker-linux ./worker
FROM scratch
COPY worker-linux /worker
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s --start-period=1s --retries=3 CMD ["/worker", "-healthcheck"]
ENTRYPOINT ["/worker"]
