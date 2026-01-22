//! Generates TypeScript bindings for the frontend
//! Run with: cargo run --bin codegen

use supiki_lib::create_specta_builder;

fn main() {
    let builder = create_specta_builder();
    builder
        .export(
            specta_typescript::Typescript::default()
                .header("/* eslint-disable */\n// @ts-nocheck"),
            "../src/bindings.ts",
        )
        .expect("Failed to export TypeScript bindings");
    println!("TypeScript bindings generated at ../src/bindings.ts");
}
