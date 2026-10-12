// Package scenarios embeds the S1–S8 scenario library (docs/09).
package scenarios

import "embed"

//go:embed S*.json
var FS embed.FS
