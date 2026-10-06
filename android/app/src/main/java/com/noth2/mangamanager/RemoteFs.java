package com.noth2.mangamanager;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

// One NAS connection's file operations. Paths are relative to the connection's
// root, '/'-separated, no leading slash ("" = the root).
interface RemoteFs {
    final class Entry {
        String name;
        boolean dir;
        long size;
        long mtime;
        boolean exists = true;
    }

    Entry stat(String rel) throws IOException; // exists=false when missing

    List<Entry> list(String rel) throws IOException;

    InputStream open(String rel) throws IOException;

    void write(String rel, InputStream data, long length) throws IOException; // replaces

    void mkdirs(String rel) throws IOException;

    void delete(String rel, boolean recursive) throws IOException;

    void rename(String from, String to) throws IOException;

    void close();
}
