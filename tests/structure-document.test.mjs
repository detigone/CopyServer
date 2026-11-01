import test from "node:test";
import assert from "node:assert/strict";
import {
    createStructureDocument,
    serializeStructureDocument,
    parseStructureDocument,
    buildStructureImportPlan
} from "../serverCloner/structureDocument.mjs";

test("exports roles, categories, channel settings and separate ALLOW/DENY overwrites", () => {
    const guild = { id: "guild-source", name: "Source", description: "Example" };
    const roles = [
        { id: "guild-source", name: "@everyone", position: 0, permissions: "1024" },
        { id: "role-admin", name: "Admin", position: 2, permissions: "8", color: 123, hoist: true, mentionable: false },
        { id: "role-managed", name: "Bot role", position: 1, permissions: "2048", managed: true }
    ];
    const channels = [
        { id: "category-a", name: "Old category", type: 4, position: 0, permission_overwrites: [{ id: "guild-source", type: 0, allow: "0", deny: "1024" }] },
        { id: "channel-a", name: "old-name", type: 0, parent_id: "category-a", position: 1, topic: "Old topic",
            permission_overwrites: [
                { id: "role-admin", type: 0, allow: "1024", deny: "2048" },
                { id: "role-managed", type: 0, allow: "2048", deny: "0" },
                { id: "user-1", type: 1, allow: "1024", deny: "0" }
            ] }
    ];
    const doc = createStructureDocument(guild, roles, channels);
    assert.equal(doc.format, "copyserver-structure");
    assert.equal(doc.version, 1);
    assert.equal(doc.roles.length, 3);
    assert.equal(doc.roles.find(role => role.key === "everyone").permissions, "1024");
    assert.equal(doc.roles.some(role => role.managedSource), true);
    assert.equal(doc.channels[1].parent, "category_1");
    assert.equal(doc.channels[1].topic, "Old topic");
    assert.deepEqual(doc.channels[0].permissionOverwrites[0], { target: "everyone", allow: "0", deny: "1024" });
    assert.deepEqual(doc.channels[1].permissionOverwrites.map(ow => ow.target), ["role", "role", "member"]);
});

test("TXT JSON round-trip and validation catch duplicate keys and broken references", () => {
    const doc = createStructureDocument(
        { id: "g", name: "Template" },
        [{ id: "g", name: "@everyone", permissions: "0", position: 0 }],
        [{ id: "cat", name: "Info", type: 4, position: 0 }, { id: "rules", name: "rules", type: 0, parent_id: "cat", position: 1 }]
    );
    const text = serializeStructureDocument(doc);
    const parsed = parseStructureDocument(text);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.document.channels[1].parent, "category_1");

    const invalid = JSON.parse(JSON.stringify(doc));
    invalid.channels[1].parent = "missing-category";
    assert.throws(() => parseStructureDocument(JSON.stringify(invalid)), /unknown parent/);
    invalid.channels[1].parent = "category_1";
    invalid.channels[1].key = invalid.channels[0].key;
    assert.throws(() => parseStructureDocument(JSON.stringify(invalid)), /Duplicate channel key/);
});

test("import plan remaps role overwrites and preserves member overwrites", () => {
    const doc = createStructureDocument(
        { id: "source-guild", name: "Template" },
        [
            { id: "source-guild", name: "@everyone", permissions: "0", position: 0 },
            { id: "source-role", name: "Staff", permissions: "268435456", position: 1 }
        ],
        [{ id: "cat", name: "Private", type: 4, position: 0, permission_overwrites: [
            { id: "source-guild", type: 0, allow: "0", deny: "1024" },
            { id: "source-role", type: 0, allow: "1024", deny: "0" },
            { id: "member-1", type: 1, allow: "1024", deny: "0" }
        ] }]
    );
    const plan = buildStructureImportPlan(doc, "target-guild");
    plan.roleMap.set("role_1", "target-role");
    assert.equal(plan.everyonePermissions, "0");
    assert.deepEqual(plan.mapOverwrites(doc.channels[0].permissionOverwrites), [
        { id: "target-guild", type: 0, allow: "0", deny: "1024" },
        { id: "target-role", type: 0, allow: "1024", deny: "0" },
        { id: "member-1", type: 1, allow: "1024", deny: "0" }
    ]);
});

test("unresolved role overwrite blocks import instead of dropping permissions", () => {
    const doc = createStructureDocument(
        { id: "g", name: "Template" },
        [{ id: "g", name: "@everyone", permissions: "0", position: 0 }],
        [{ id: "ch", name: "private", type: 0, permission_overwrites: [{ id: "unknown-role", type: 0, allow: "1024", deny: "0" }] }]
    );
    const plan = buildStructureImportPlan(doc, "target");
    assert.throws(() => plan.mapOverwrites(doc.channels[0].permissionOverwrites), /cannot be mapped safely/);
});
