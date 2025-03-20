FROM docker.io/rust:latest AS builder

RUN apt-get update && \
	apt-get install -y musl-tools musl-dev protobuf-compiler cmake && \
	rustup target add x86_64-unknown-linux-musl && \
  update-ca-certificates

WORKDIR /src

COPY ./dash-mpd ./

RUN cargo update && \
    cargo build --target x86_64-unknown-linux-musl --release

FROM node:22-alpine

RUN apk update && apk upgrade && \
    apk add --no-cache ca-certificates ffmpeg bento4 && \
    update-ca-certificates

COPY --from=builder --chown=root:root --chmod=755 \
    /src/target/x86_64-unknown-linux-musl/release/dash-mpd /usr/local/bin/

ENV TERM=xterm-256color

ENTRYPOINT ["/usr/local/bin/dash-mpd"]
